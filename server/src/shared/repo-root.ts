import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 定位仓库根目录（含 package.json 的目录）。
 *
 * tsx 直跑源码时从当前模块位置向上探测；esbuild 打包后 bundle 位于
 * dist-server/（或其 chunk），同样向上找到部署根（Docker 镜像 WORKDIR /app、
 * 本地 dev 仓库根、native release 根）。都失败时回退进程工作目录。
 */
export function resolveRepoRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  let dir = moduleDir
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return process.cwd()
}

/** 返回第一个存在的候选路径；都不存在时返回第一个（保留原始错误语义） */
export function resolveFirstExisting(...candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return candidates[0]!
}
