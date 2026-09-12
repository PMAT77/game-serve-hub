import fs from 'node:fs'
import path from 'node:path'
import { extractZipArchive } from '../../backup/zip-extract'
import { DST_CLUSTER_NAME, DST_WORKSHOP_APP_ID, resolveDstSteamWorkshopModDir } from './constants'
import { isCavesShardConfigured } from './shard-layout'

export type DstShardFolder = 'Master' | 'Caves'

export interface UgcModInstallOutcome {
  workshopId: string
  /** installed=本次落位；skipped=DST 目录已就绪；failed=落位失败（DST 将无法加载该 Mod） */
  status: 'installed' | 'skipped' | 'failed'
  error?: string
}

const MOD_INFO_FILE_NAME = 'modinfo.lua'
const MOD_MAIN_FILE_NAME = 'modmain.lua'
const MOD_MANIFEST_FILE_NAME = 'mod.manifest'
const LEGACY_ARCHIVE_SUFFIX = '_legacy.bin'

/**
 * DST 专用服只从 ugc_mods 读取创意工坊 Mod（启动日志「already have IDs」来自该目录扫描），
 * SteamCMD 的 steamapps/workshop/content 下载位置它完全不看。因此下载完成后必须把内容
 * 复制/解包到本函数给出的目录，否则 DST 会自己联网重下，legacy 包（ugchandle）常因超时失败。
 */
export function resolveDstUgcModDir(installPath: string, shardFolder: DstShardFolder, workshopId: string): string {
  return path.join(
    installPath,
    'ugc_mods',
    DST_CLUSTER_NAME,
    shardFolder,
    'content',
    DST_WORKSHOP_APP_ID,
    workshopId,
  )
}

/** 需要落位的分片：洞穴未配置时只处理地上，与 DST 实际运行的分片保持一致 */
export function resolveDstUgcShardFolders(installPath: string): DstShardFolder[] {
  return isCavesShardConfigured(installPath) ? ['Master', 'Caves'] : ['Master']
}

function hasModInfoFile(dir: string): boolean {
  return fs.existsSync(path.join(dir, MOD_INFO_FILE_NAME))
}

/** DST 可加载的判定：目标目录存在 modinfo.lua */
export function isDstUgcModReady(
  installPath: string,
  workshopId: string,
  shardFolders: DstShardFolder[] = resolveDstUgcShardFolders(installPath),
): boolean {
  const normalizedId = workshopId.trim()
  if (!normalizedId || !installPath) {
    return false
  }
  return shardFolders.every(shardFolder => hasModInfoFile(resolveDstUgcModDir(installPath, shardFolder, normalizedId)))
}

/** SteamCMD 与历史布局下的 Mod 来源目录（按优先级） */
export function resolveDstWorkshopSourceDirs(installPath: string, workshopId: string): string[] {
  return [
    resolveDstSteamWorkshopModDir(installPath, workshopId),
    path.join(installPath, 'mods', `workshop-${workshopId}`),
  ]
}

type ModSource = { kind: 'dir', dir: string } | { kind: 'legacy', dir: string, archivePath: string }

function findLegacyArchive(dir: string): string | null {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  }
  catch {
    return null
  }
  const archiveName = entries.find(name => name.toLowerCase().endsWith(LEGACY_ARCHIVE_SUFFIX))
  return archiveName ? path.join(dir, archiveName) : null
}

/** 解析可用来源：完整目录优先，其次 legacy 压缩包 */
export function resolveDstWorkshopModSource(installPath: string, workshopId: string): ModSource | null {
  for (const dir of resolveDstWorkshopSourceDirs(installPath, workshopId)) {
    if (!fs.existsSync(dir)) {
      continue
    }
    if (hasModInfoFile(dir)) {
      return { kind: 'dir', dir }
    }
    const legacyArchive = findLegacyArchive(dir)
    if (legacyArchive) {
      return { kind: 'legacy', dir, archivePath: legacyArchive }
    }
    if (fs.existsSync(path.join(dir, MOD_MAIN_FILE_NAME)) || fs.existsSync(path.join(dir, MOD_MANIFEST_FILE_NAME))) {
      return { kind: 'dir', dir }
    }
  }
  return null
}

function describeSource(source: ModSource): string {
  return source.kind === 'legacy' ? source.archivePath : source.dir
}

/** 先写临时目录再原子改名，保证 DST 不会读到半成品目录 */
async function installModIntoDirectory(source: ModSource, targetDir: string): Promise<void> {
  const tempDir = `${targetDir}.tmp-${process.pid}-${Date.now().toString(36)}`
  fs.rmSync(tempDir, { recursive: true, force: true })
  try {
    if (source.kind === 'legacy') {
      // legacy 包（*_legacy.bin）实测为标准 zip；解压失败即视为损坏包
      await extractZipArchive(source.archivePath, tempDir)
    }
    else {
      fs.mkdirSync(path.dirname(tempDir), { recursive: true })
      fs.cpSync(source.dir, tempDir, { recursive: true })
    }
    if (!hasModInfoFile(tempDir)) {
      throw new Error(`Mod 内容缺少 ${MOD_INFO_FILE_NAME}（来源：${describeSource(source)}）`)
    }
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.renameSync(tempDir, targetDir)
  }
  catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
}

/**
 * 将已下载的创意工坊 Mod 落位到 DST 的 ugc_mods 目录（幂等）。
 * 单个 Mod 失败只影响该 Mod，不抛出异常。
 */
export async function ensureDstUgcModLayout(
  installPath: string,
  workshopIds: string[],
  options: { shardFolders?: DstShardFolder[] } = {},
): Promise<UgcModInstallOutcome[]> {
  const normalizedIds = [...new Set(workshopIds.map(id => id.trim()).filter(Boolean))]
  if (normalizedIds.length === 0) {
    return []
  }
  if (!installPath || !fs.existsSync(installPath)) {
    return normalizedIds.map(workshopId => ({
      workshopId,
      status: 'failed' as const,
      error: `实例安装目录不存在：${installPath || '(空)'}`,
    }))
  }

  const shardFolders = options.shardFolders ?? resolveDstUgcShardFolders(installPath)
  const outcomes: UgcModInstallOutcome[] = []
  const sourceCache = new Map<string, ModSource | null>()

  for (const workshopId of normalizedIds) {
    const pendingShards = shardFolders.filter(
      shardFolder => !hasModInfoFile(resolveDstUgcModDir(installPath, shardFolder, workshopId)),
    )
    if (pendingShards.length === 0) {
      outcomes.push({ workshopId, status: 'skipped' })
      continue
    }
    if (!sourceCache.has(workshopId)) {
      sourceCache.set(workshopId, resolveDstWorkshopModSource(installPath, workshopId))
    }
    const source = sourceCache.get(workshopId) ?? null
    if (!source) {
      outcomes.push({
        workshopId,
        status: 'failed',
        error: `未找到已下载的 Mod 文件：${resolveDstWorkshopSourceDirs(installPath, workshopId).join(' 或 ')}`,
      })
      continue
    }
    try {
      for (const shardFolder of pendingShards) {
        await installModIntoDirectory(source, resolveDstUgcModDir(installPath, shardFolder, workshopId))
      }
      outcomes.push({ workshopId, status: 'installed' })
    }
    catch (error) {
      outcomes.push({
        workshopId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return outcomes
}
