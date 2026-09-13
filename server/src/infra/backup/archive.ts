import type { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGunzip } from 'node:zlib'

/**
 * 备份归档基础设施：调用操作系统自带的 tar 生成/解包 tar.gz。
 * - Linux（生产 Docker 镜像与 Native 宿主机）tar 为必备组件；
 * - Windows 10 1803+ 内置 bsdtar，覆盖开发与测试环境；
 * - 解包时不捕获 tar 输出（stdio: 'ignore'），成败以退出码判定，避免管道依赖；
 *   需要条目清单时改写临时文件（stdio 传 fd）而不是接管道，保持同一种执行方式。
 */

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: 'ignore', windowsHide: true })
    child.on('error', (error) => {
      reject(new Error(`tar 命令不可用: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`tar 执行失败，退出码 ${code ?? 'unknown'}`))
    })
  })
}

/** 打包目录为 tar.gz，包内顶层目录名保持为源目录的 basename（恢复时可按顶层目录对齐） */
export async function createDirectoryArchive(sourceDir: string, targetPath: string): Promise<void> {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`待备份目录不存在: ${sourceDir}`)
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const parent = path.dirname(sourceDir)
  const base = path.basename(sourceDir)
  await runTar(['-czf', targetPath, '-C', parent, base])
}

/** tar.gz 解包上限：条目数与解压后总字节数（防解压炸弹），与 zip 侧口径保持一致 */
export interface TarExtractLimits {
  maxEntries: number
  maxTotalUncompressedBytes: number
}

/** 默认解压上限：10 万条目 / 4GB（DST 集群档远低于此） */
export const DEFAULT_TAR_EXTRACT_LIMITS: TarExtractLimits = {
  maxEntries: 100_000,
  maxTotalUncompressedBytes: 4 * 1024 * 1024 * 1024,
}

function formatBytesLimit(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`
}

/**
 * 用文件重定向而非管道收集 tar 的条目清单。
 * 不捕获 stdout 管道（与 runTar 保持一致的执行方式），条目名按行切分——
 * tar 条目名理论上可含换行，但存档目录不会出现，可接受。
 */
function listArchiveEntries(archivePath: string): Promise<string[]> {
  const listPath = path.join(os.tmpdir(), `gsh-tar-entries-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const fd = fs.openSync(listPath, 'w')
  return new Promise<string[]>((resolve, reject) => {
    const cleanup = () => {
      try {
        fs.closeSync(fd)
      }
      catch {
        // 已关闭
      }
      fs.rmSync(listPath, { force: true })
    }
    const child = spawn('tar', ['-tzf', archivePath], { stdio: ['ignore', fd, 'ignore'], windowsHide: true })
    child.on('error', (error) => {
      cleanup()
      reject(new Error(`tar 命令不可用: ${error.message}`))
    })
    child.on('close', (code) => {
      try {
        if (code !== 0) {
          reject(new Error(`tar 读取压缩包失败，退出码 ${code ?? 'unknown'}`))
          return
        }
        const raw = fs.readFileSync(listPath, 'utf8')
        resolve(raw.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.length > 0))
      }
      catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      finally {
        cleanup()
      }
    })
  })
}

/** 条目路径必须落在解压根内：拒绝绝对路径与 `..` 逃逸（与 zip 侧的包含性校验等价） */
function assertEntryPathInsideRoot(root: string, entry: string): void {
  const normalized = entry.replace(/^\.\//, '')
  if (normalized === '' || normalized === '.') {
    return
  }
  if (path.isAbsolute(normalized) || /^[A-Za-z]:[\\/]/.test(normalized)) {
    throw new Error(`压缩包内出现绝对路径条目: ${entry}`)
  }
  const resolved = path.resolve(root, normalized)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`压缩包内出现非法路径条目: ${entry}`)
  }
}

/**
 * 流式解压 gzip 统计解压后总字节数，超出上限立即中止。
 * 这一步不落盘，因此能在写文件之前拦住高压缩比的解压炸弹。
 */
async function assertGzipExpansionWithinLimit(archivePath: string, maxBytes: number): Promise<void> {
  const stream: Readable = fs.createReadStream(archivePath).pipe(createGunzip())
  let total = 0
  try {
    for await (const chunk of stream) {
      total += (chunk as Buffer).length
      if (total > maxBytes) {
        throw new Error(`解压后总大小超过上限（${formatBytesLimit(maxBytes)}）`)
      }
    }
  }
  finally {
    stream.destroy()
  }
}

/** 解包 tar.gz 到目标目录：解压前校验条目数与解压后总大小，并拒绝逃逸路径 */
export async function extractArchive(
  archivePath: string,
  targetDir: string,
  limits: TarExtractLimits = DEFAULT_TAR_EXTRACT_LIMITS,
): Promise<void> {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`备份包不存在: ${archivePath}`)
  }
  const entries = await listArchiveEntries(archivePath)
  if (entries.length > limits.maxEntries) {
    throw new Error(`压缩包条目数超过上限（${limits.maxEntries}）`)
  }
  const root = path.resolve(targetDir)
  for (const entry of entries) {
    assertEntryPathInsideRoot(root, entry)
  }
  await assertGzipExpansionWithinLimit(archivePath, limits.maxTotalUncompressedBytes)
  fs.mkdirSync(targetDir, { recursive: true })
  await runTar(['-xzf', archivePath, '-C', targetDir])
}

/**
 * 同卷原子替换目录（用于恢复时换入解包后的存档）：
 * 现目录先改名让位 → 新目录改名就位；就位失败回滚让位目录，成功后清理让位目录。
 * 调用方须保证 preparedDir 与 dirPath 在同一卷（同父目录下建 staging 可满足）。
 */
export function replaceDirectory(dirPath: string, preparedDir: string): void {
  const parent = path.dirname(dirPath)
  const displaced = path.join(parent, `.replaced-${path.basename(dirPath)}-${Date.now()}`)
  let displacedReady = false
  if (fs.existsSync(dirPath)) {
    fs.renameSync(dirPath, displaced)
    displacedReady = true
  }
  try {
    fs.renameSync(preparedDir, dirPath)
  }
  catch (error) {
    if (displacedReady) {
      fs.renameSync(displaced, dirPath)
    }
    throw error
  }
  if (displacedReady) {
    fs.rmSync(displaced, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 })
  }
}

/** 递归计算目录字节数（符号链接不跟随） */
export function getDirectorySizeBytes(dirPath: string): number {
  let total = 0
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(entryPath)
      continue
    }
    if (entry.isFile()) {
      total += fs.statSync(entryPath).size
    }
  }
  return total
}
