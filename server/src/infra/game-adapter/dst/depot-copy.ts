import fs from 'node:fs'
import path from 'node:path'

/** 实例存档与房间配置，seed 复制时必须隔离 */
const EXCLUDED_TOP_LEVEL = new Set(['klei-storage'])
const STEAMAPPS_EXCLUDED_TOP_LEVEL = new Set(['downloading', 'temp', 'sourcemods'])

export type CopyGameDepotResult = { ok: true } | { ok: false, error: string }

function shouldCopySteamappsChild(sourcePath: string, steamappsRoot: string): boolean {
  const relative = path.relative(steamappsRoot, sourcePath)
  if (!relative || relative === '.') {
    return true
  }
  const topLevel = relative.split(path.sep)[0]
  return !STEAMAPPS_EXCLUDED_TOP_LEVEL.has(topLevel)
}

function copySteamappsDirectory(donorPath: string, recipientPath: string): void {
  const sourceRoot = path.join(donorPath, 'steamapps')
  const targetRoot = path.join(recipientPath, 'steamapps')
  if (!fs.existsSync(sourceRoot)) {
    return
  }
  fs.mkdirSync(targetRoot, { recursive: true })
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (STEAMAPPS_EXCLUDED_TOP_LEVEL.has(entry.name)) {
      continue
    }
    const sourceEntry = path.join(sourceRoot, entry.name)
    const targetEntry = path.join(targetRoot, entry.name)
    if (entry.isDirectory()) {
      fs.cpSync(sourceEntry, targetEntry, {
        recursive: true,
        force: true,
        filter: src => shouldCopySteamappsChild(src, sourceRoot),
      })
    }
    else {
      fs.copyFileSync(sourceEntry, targetEntry)
    }
  }
}

function copyTopLevelEntry(donorPath: string, recipientPath: string, entry: fs.Dirent): void {
  const sourceEntry = path.join(donorPath, entry.name)
  const targetEntry = path.join(recipientPath, entry.name)
  if (entry.name === 'steamapps') {
    copySteamappsDirectory(donorPath, recipientPath)
    return
  }
  if (entry.isDirectory()) {
    fs.cpSync(sourceEntry, targetEntry, { recursive: true, force: true })
    return
  }
  fs.copyFileSync(sourceEntry, targetEntry)
}

/**
 * 从 donor 复制游戏 depot 到 recipient（除 klei-storage 外完整 depot，不含存档）。
 */
export function copyGameDepotFromDonor(donorPath: string, recipientPath: string): CopyGameDepotResult {
  const normalizedDonor = path.resolve(donorPath.trim())
  const normalizedRecipient = path.resolve(recipientPath.trim())
  if (!normalizedDonor || !normalizedRecipient) {
    return { ok: false, error: '安装路径无效' }
  }
  if (normalizedDonor === normalizedRecipient) {
    return { ok: false, error: '供体与目标安装目录不能相同' }
  }
  if (!fs.existsSync(normalizedDonor)) {
    return { ok: false, error: '供体安装目录不存在' }
  }
  try {
    fs.mkdirSync(normalizedRecipient, { recursive: true })
    for (const entry of fs.readdirSync(normalizedDonor, { withFileTypes: true })) {
      if (EXCLUDED_TOP_LEVEL.has(entry.name)) {
        continue
      }
      copyTopLevelEntry(normalizedDonor, normalizedRecipient, entry)
    }
    return { ok: true }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `复制游戏文件失败: ${message}` }
  }
}
