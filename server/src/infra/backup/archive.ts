import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 备份归档基础设施：调用操作系统自带的 tar 生成/解包 tar.gz。
 * - Linux（生产 Docker 镜像与 Native 宿主机）tar 为必备组件；
 * - Windows 10 1803+ 内置 bsdtar，覆盖开发与测试环境；
 * - 不捕获 tar 输出（stdio: 'ignore'），成败以退出码判定，避免管道依赖。
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

/** 解包 tar.gz 到目标目录 */
export async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`备份包不存在: ${archivePath}`)
  }
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
