import fs from 'node:fs'
import path from 'node:path'
import { backupFile, writeFileAtomic } from './atomic-write'
import { ensureClusterDirectory, resolveClusterPaths } from './cluster-service'
import { buildLuaConfigurationOptionsInline } from './mod-config'

const MOD_SETUP_FILE_NAME = 'dedicated_server_mods_setup.lua'
const MOD_OVERRIDES_FILE_NAME = 'modoverrides.lua'
const MOD_META_FILE_NAME = '.gsh-mod-meta.json'

export interface DstModEntry {
  workshopId: string
  enabled: boolean
  loadOrder: number
  /** modoverrides.lua 的 configuration_options；空/undefined 不输出该字段 */
  configurationOptions?: Record<string, string | number | boolean> | null
}

export type DstModDependencyMap = Record<string, string[]>

function toWorkshopKey(workshopId: string) {
  return `workshop-${workshopId}`
}

function normalizeDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const unique = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }
    const normalized = item.trim()
    if (normalized) {
      unique.add(normalized)
    }
  }
  return [...unique]
}

function buildModSetupContent(mods: DstModEntry[]): string {
  const lines = mods
    .map(mod => mod.workshopId.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map(workshopId => `ServerModSetup("${workshopId}")`)
  return `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`
}

function buildModOverridesContent(mods: DstModEntry[]): string {
  const sorted = [...mods]
    .filter(mod => mod.workshopId.trim())
    .sort((a, b) => a.loadOrder - b.loadOrder || a.workshopId.localeCompare(b.workshopId, 'en'))
  if (sorted.length === 0) {
    return 'return {}\n'
  }
  const rows = sorted.map((mod) => {
    const configInline = buildLuaConfigurationOptionsInline(mod.configurationOptions ?? {})
    return `  ["${toWorkshopKey(mod.workshopId)}"]={ enabled=${mod.enabled ? 'true' : 'false'}${configInline} },`
  })
  return ['return {', ...rows, '}'].join('\n') + '\n'
}

function writeModOverridesByShard(installPath: string, content: string) {
  const { clusterRoot } = resolveClusterPaths(installPath)
  const masterDir = path.join(clusterRoot, 'Master')
  const cavesDir = path.join(clusterRoot, 'Caves')
  fs.mkdirSync(masterDir, { recursive: true })
  fs.mkdirSync(cavesDir, { recursive: true })
  const masterModOverridesPath = path.join(masterDir, MOD_OVERRIDES_FILE_NAME)
  backupFile(masterModOverridesPath)
  writeFileAtomic(masterModOverridesPath, content)
  const cavesModOverridesPath = path.join(cavesDir, MOD_OVERRIDES_FILE_NAME)
  backupFile(cavesModOverridesPath)
  writeFileAtomic(cavesModOverridesPath, content)
}

function writeDedicatedServerModSetup(installPath: string, content: string) {
  const modsDir = path.join(installPath, 'mods')
  fs.mkdirSync(modsDir, { recursive: true })
  const legacyPath = path.join(modsDir, MOD_SETUP_FILE_NAME)
  backupFile(legacyPath)
  writeFileAtomic(legacyPath, content)
}

function writeClusterModSetup(installPath: string, content: string) {
  const { clusterRoot } = resolveClusterPaths(installPath)
  const clusterSetupPath = path.join(clusterRoot, MOD_SETUP_FILE_NAME)
  backupFile(clusterSetupPath)
  writeFileAtomic(clusterSetupPath, content)
}

function resolveModMetaPath(installPath: string): string {
  const { clusterRoot } = resolveClusterPaths(installPath)
  return path.join(clusterRoot, MOD_META_FILE_NAME)
}

export function readModDependencyMap(installPath: string): DstModDependencyMap {
  const modMetaPath = resolveModMetaPath(installPath)
  if (!fs.existsSync(modMetaPath)) {
    return {}
  }
  try {
    const raw = JSON.parse(fs.readFileSync(modMetaPath, 'utf8')) as Record<string, unknown>
    const map: DstModDependencyMap = {}
    for (const [workshopId, dependencyIds] of Object.entries(raw)) {
      const normalizedWorkshopId = workshopId.trim()
      if (!normalizedWorkshopId) {
        continue
      }
      map[normalizedWorkshopId] = normalizeDependencyIds(dependencyIds)
    }
    return map
  }
  catch {
    return {}
  }
}

export function writeModDependencyMap(installPath: string, dependencyMap: DstModDependencyMap) {
  const modMetaPath = resolveModMetaPath(installPath)
  backupFile(modMetaPath)
  writeFileAtomic(modMetaPath, `${JSON.stringify(dependencyMap, null, 2)}\n`)
}

export function writeInstanceModFiles(installPath: string, mods: DstModEntry[]) {
  ensureClusterDirectory(installPath)
  const modSetupContent = buildModSetupContent(mods)
  // DST 会从安装根目录 mods/dedicated_server_mods_setup.lua 读取订阅列表。
  writeDedicatedServerModSetup(installPath, modSetupContent)
  // 兼容已有目录结构，继续同步到 Cluster 根目录，便于历史数据排查。
  writeClusterModSetup(installPath, modSetupContent)
  writeModOverridesByShard(installPath, buildModOverridesContent(mods))
}
