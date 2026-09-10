import type { Readable } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'

/** zip 解压上限：条目数与解压后总字节数（防 zip bomb） */
export interface ZipExtractLimits {
  maxEntries: number
  maxTotalUncompressedBytes: number
}

/** 默认解压上限：10 万条目 / 4GB（DST 集群档远低于此） */
export const DEFAULT_ZIP_EXTRACT_LIMITS: ZipExtractLimits = {
  maxEntries: 100_000,
  maxTotalUncompressedBytes: 4 * 1024 * 1024 * 1024,
}

/**
 * 解压 zip 到目标目录（流式逐条目，内存占用恒定）。
 * - 路径安全：yauzl 层拒绝 `..`/绝对路径/反斜杠条目；此处再做 resolve 包含性校验（纵深防御）；
 * - 条目声明大小与实际流大小双重计数，超出上限即中止；
 * - 失败时目标目录可能留有部分文件，由调用方整体清理。
 */
export async function extractZipArchive(zipPath: string, targetDir: string, limits: ZipExtractLimits = DEFAULT_ZIP_EXTRACT_LIMITS): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true })
  const root = path.resolve(targetDir)
  const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false })
  let entriesSeen = 0
  let declaredBytes = 0
  let streamedBytes = 0

  const formatLimit = `${Math.floor(limits.maxTotalUncompressedBytes / (1024 * 1024))} MB`

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      zipfile.on('error', fail)
      zipfile.on('end', () => {
        if (settled) {
          return
        }
        settled = true
        resolve()
      })

      zipfile.on('entry', (entry: yauzl.Entry) => {
        try {
          if (settled) {
            return
          }
          entriesSeen += 1
          if (entriesSeen > limits.maxEntries) {
            fail(new Error(`压缩包条目数超过上限（${limits.maxEntries}）`))
            return
          }

          const entryName = entry.fileName
          const resolved = path.resolve(root, entryName)
          if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            fail(new Error(`压缩包内出现非法路径条目: ${entryName}`))
            return
          }

          // 目录条目（yauzl 以 `/` 结尾标识）
          if (entryName.endsWith('/')) {
            fs.mkdirSync(resolved, { recursive: true })
            zipfile.readEntry()
            return
          }

          // 中央目录声明大小预检（声明可造假，流式读取时逐块复核）
          declaredBytes += entry.uncompressedSize
          if (declaredBytes > limits.maxTotalUncompressedBytes) {
            fail(new Error(`解压后总大小超过上限（${formatLimit}）`))
            return
          }

          void zipfile.openReadStreamPromise(entry).then((readStream: Readable) => {
            if (settled) {
              readStream.destroy()
              return
            }
            fs.mkdirSync(path.dirname(resolved), { recursive: true })
            const writeStream = fs.createWriteStream(resolved)
            writeStream.on('error', fail)
            readStream.on('error', fail)
            readStream.on('data', (chunk: Buffer) => {
              streamedBytes += chunk.length
              if (streamedBytes > limits.maxTotalUncompressedBytes) {
                fail(new Error(`解压后总大小超过上限（${formatLimit}）`))
                readStream.destroy()
                writeStream.destroy()
              }
            })
            readStream.pipe(writeStream)
            writeStream.on('finish', () => {
              if (settled) {
                return
              }
              zipfile.readEntry()
            })
          }, fail)
        }
        catch (error) {
          fail(error)
        }
      })

      zipfile.readEntry()
    })
  }
  finally {
    zipfile.close()
  }
}
