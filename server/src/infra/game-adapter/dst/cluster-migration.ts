import fs from 'node:fs'
import path from 'node:path'
import { getDirectorySizeBytes } from '../../backup/archive'
import { parseClusterIni } from './cluster-ini'
import { parseModOverridesEntries } from './mod-config'
import { parseServerIni } from './server-ini'

/**
 * 集群迁移的共用逻辑：识别集群目录、体检、生成给人看的迁移报告。
 *
 * 为什么单独放一层：同一份判断要服务两个入口——仓库里的迁移导出脚本
 * （`scripts/export-cluster-archive.ts`，用于从**别的机器**上整理存档）与面板内的
 * 「导出迁移包」（用于从**本面板管理的实例**导出）。两处各写一遍的结果，是包能导出、
 * 报告却说错了端口或漏了 Mod。所以这里只放纯读逻辑，打包与下载留在各自入口。
 */

/** 目录含 cluster.ini 即视为 DST 集群目录（与面板存档导入的识别口径一致） */
export function isClusterDirectory(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, 'cluster.ini'))
}

const SHARD_NAMES = ['Master', 'Caves'] as const
export type ShardName = typeof SHARD_NAMES[number]

/** 扫描时跳过的目录名：备份、实例根、运行时与日志里不会有「当前正在用的集群」 */
const SKIPPED_DIR_NAMES = /^(backups?|instances|runtime|logs|ugc_mods|node_modules)$/i

export interface DiscoverClustersOptions {
  /** 递归深度上限（相对 sourceRoot） */
  maxDepth?: number
}

/**
 * 在源目录下找出集群目录。
 *
 * 三种真实来源都要覆盖：本面板实例的 `klei-storage/DoNotStarveTogether/Cluster_1`、
 * 旧面板的同类布局、玩家客户端的 `DoNotStarveTogether/<userid>/Cluster_N`。
 * 因此按「自身是集群 → 浅层 Cluster_* → 更深层的 cluster.ini」逐级放宽，
 * 但一旦在浅层找到就不再深挖，避免把备份目录里的副本也当成待迁移的集群。
 */
export function discoverClusters(sourceRoot: string, options: DiscoverClustersOptions = {}): string[] {
  const maxDepth = options.maxDepth ?? 4
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return []
  }
  if (isClusterDirectory(sourceRoot)) {
    return [sourceRoot]
  }

  const shallow: string[] = []
  const walkShallow = (dir: string, depth: number) => {
    for (const entry of safeReadDir(dir)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue
      }
      const child = path.join(dir, entry.name)
      if (/^cluster_\d+$/i.test(entry.name) && isClusterDirectory(child)) {
        shallow.push(child)
        continue
      }
      if (depth < maxDepth) {
        walkShallow(child, depth + 1)
      }
    }
  }
  walkShallow(sourceRoot, 0)
  if (shallow.length > 0) {
    return shallow
  }

  const deep: string[] = []
  const walkDeep = (dir: string, depth: number) => {
    for (const entry of safeReadDir(dir)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIR_NAMES.test(entry.name)) {
        continue
      }
      const child = path.join(dir, entry.name)
      if (isClusterDirectory(child)) {
        deep.push(child)
        continue
      }
      if (depth < maxDepth + 2) {
        walkDeep(child, depth + 1)
      }
    }
  }
  walkDeep(sourceRoot, 0)
  return deep
}

function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
  }
  catch {
    return []
  }
}

export interface MigrationShardReport {
  name: ShardName
  dir: string
  hasSave: boolean
  saveBytes: number
  serverPort: number | null
  steamAuthPort: number | null
  steamMasterPort: number | null
  modOverrideFile: boolean
}

export interface MigrationClusterReport {
  dirName: string
  clusterPath: string
  clusterName: string
  totalBytes: number
  hasToken: boolean
  playerListFiles: string[]
  shards: MigrationShardReport[]
  mods: { enabled: number, disabled: number, ids: string[] }
  warnings: string[]
}

function inspectShard(clusterPath: string, shard: ShardName): MigrationShardReport | null {
  const dir = path.join(clusterPath, shard)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return null
  }
  const saveDir = path.join(dir, 'save')
  const hasSave = fs.existsSync(saveDir) && fs.statSync(saveDir).isDirectory()
  let serverPort: number | null = null
  let steamAuthPort: number | null = null
  let steamMasterPort: number | null = null
  const serverIniPath = path.join(dir, 'server.ini')
  if (fs.existsSync(serverIniPath)) {
    try {
      const parsed = parseServerIni(fs.readFileSync(serverIniPath, 'utf8'), shard === 'Master' ? 'master' : 'caves')
      serverPort = parsed.fields.serverPort
      steamAuthPort = parsed.fields.steamAuthPort
      steamMasterPort = parsed.fields.steamMasterPort
    }
    catch {
      // 解析失败按「没读到端口」处理，报告里会提示人工核对
    }
  }
  return {
    name: shard,
    dir,
    hasSave,
    saveBytes: hasSave ? getDirectorySizeBytes(saveDir) : 0,
    serverPort,
    steamAuthPort,
    steamMasterPort,
    modOverrideFile: fs.existsSync(path.join(dir, 'modoverrides.lua')),
  }
}

function collectMods(clusterPath: string): MigrationClusterReport['mods'] {
  // Master 优先，Master 没有 modoverrides.lua 时退回 Caves（与面板导入的反向解析口径一致）
  const candidates = [
    path.join(clusterPath, 'Master', 'modoverrides.lua'),
    path.join(clusterPath, 'Caves', 'modoverrides.lua'),
  ]
  const file = candidates.find(item => fs.existsSync(item))
  if (!file) {
    return { enabled: 0, disabled: 0, ids: [] }
  }
  const entries = parseModOverridesEntries(file)
  const enabled = entries.filter(entry => entry.enabled)
  return {
    enabled: enabled.length,
    disabled: entries.length - enabled.length,
    // 解析器给的是纯数字 ID，而人对人流转用的是工坊页的 `workshop-<id>` 形式：
    // 报告会被直接粘进 SteamCMD 或搜索框，缺前缀的 ID 是没法用的
    ids: entries.map(entry => `workshop-${entry.workshopId}${entry.enabled ? '' : '（未启用）'}`),
  }
}

function readClusterName(clusterPath: string): string {
  try {
    const content = fs.readFileSync(path.join(clusterPath, 'cluster.ini'), 'utf8')
    return parseClusterIni(content).fields.clusterName || path.basename(clusterPath)
  }
  catch {
    return path.basename(clusterPath)
  }
}

/** 体检一个集群目录：分片、端口、Mod、名单、令牌，以及迁移前必须确认的风险项 */
export function inspectClusterForMigration(clusterPath: string): MigrationClusterReport {
  const shards = SHARD_NAMES
    .map(shard => inspectShard(clusterPath, shard))
    .filter((item): item is MigrationShardReport => item !== null)
  const warnings: string[] = []

  const master = shards.find(shard => shard.name === 'Master')
  if (!master) {
    warnings.push('没有 Master 分片目录：导入后主世界无法启动')
  }
  if (master && !master.hasSave) {
    warnings.push('Master 分片没有 save 目录：这是没生成过世界的空档，导入后世界需要重新生成')
  }
  const caves = shards.find(shard => shard.name === 'Caves')
  if (master?.serverPort != null && caves?.serverPort != null && caves.serverPort !== master.serverPort + 1) {
    warnings.push(`洞穴的 server_port（${caves.serverPort}）不是主世界端口 ${master.serverPort} 加一：迁移后要按目标实例的端口重排`)
  }

  const tokenPath = path.join(clusterPath, 'cluster_token.txt')
  if (!fs.existsSync(tokenPath)) {
    warnings.push('没有 cluster_token.txt：导入时需要在面板里填写令牌，否则进不去服')
  }
  else if (fs.statSync(tokenPath).size === 0) {
    warnings.push('cluster_token.txt 是空文件：令牌需要重新获取')
  }

  const playerListFiles = ['adminlist.txt', 'whitelist.txt', 'blocklist.txt']
    .filter(name => fs.existsSync(path.join(clusterPath, name)))

  const extraShardDirs = safeReadDir(clusterPath)
    .filter(entry => entry.isDirectory() && entry.name !== 'Master' && entry.name !== 'Caves')
    .map(entry => entry.name)
  if (extraShardDirs.length > 0) {
    warnings.push(`存在面板不会启动的分片目录（${extraShardDirs.join('、')}）：会原样打包，但迁移后不会运行`)
  }

  return {
    dirName: path.basename(clusterPath),
    clusterPath,
    clusterName: readClusterName(clusterPath),
    totalBytes: getDirectorySizeBytes(clusterPath),
    hasToken: fs.existsSync(tokenPath),
    playerListFiles,
    shards,
    mods: collectMods(clusterPath),
    warnings,
  }
}

/** 报告里用的人类可读体积（不引入依赖，按 KiB / MiB 两档足够） */
export function formatBytesForReport(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export interface MigrationReportTextOptions {
  /** 压缩包文件名；面板内导出时传入，脚本里传实际产物名 */
  archiveName?: string
  /** 面板导入侧探测自检的结论，有则追加为第六节 */
  importProbe?: { ok: boolean, clusterName?: string | null, dirName?: string, message?: string }
  /** 额外补充的「下一步」说明，例如面板内导出要指明导入入口 */
  nextSteps?: string[]
}

/**
 * 生成迁移报告文本。
 *
 * 纪律：**不打印集群令牌与房间密码**。报告会被贴进群里、发给客户或留在交付目录里，
 * 任何一处带出凭据都是泄露；需要凭据的人自己去看源文件。
 */
export function buildMigrationReportText(
  report: MigrationClusterReport,
  options: MigrationReportTextOptions = {},
): string {
  const lines: string[] = []
  lines.push(`集群迁移报告：${report.clusterName}`)
  lines.push(`生成时间：${new Date().toISOString()}`)
  lines.push(`源目录：${report.clusterPath}`)
  if (options.archiveName) {
    lines.push(`压缩包：${options.archiveName}`)
  }
  lines.push(`包内顶层目录：${report.dirName}`)
  lines.push(`压缩前大小：${formatBytesForReport(report.totalBytes)}`)
  lines.push('')
  lines.push('一、分片')
  lines.push('  分片        存档        存档大小      server_port  steam_auth  steam_master  端口配置文件')
  for (const shard of report.shards) {
    lines.push(
      `  ${shard.name.padEnd(10)}  ${shard.hasSave ? '有  ' : '无  '}      ${formatBytesForReport(shard.saveBytes).padEnd(12)}  `
      + `${String(shard.serverPort ?? '-').padEnd(12)}  ${String(shard.steamAuthPort ?? '-').padEnd(10)}  `
      + `${String(shard.steamMasterPort ?? '-').padEnd(12)}  ${shard.modOverrideFile ? '有' : '无'}`,
    )
  }
  lines.push('')
  lines.push('二、Mod')
  lines.push(`  启用 ${report.mods.enabled} 个，未启用 ${report.mods.disabled} 个`)
  if (report.mods.ids.length > 0) {
    lines.push(`  工坊 ID：${report.mods.ids.join('、')}`)
  }
  lines.push('')
  lines.push('三、玩家名单')
  lines.push(report.playerListFiles.length > 0 ? `  已包含：${report.playerListFiles.join('、')}` : '  未发现名单文件')
  lines.push(`  集群令牌：${report.hasToken ? '包内有 cluster_token.txt（迁移后确认仍有效）' : '包内没有，导入时需填写'}`)
  lines.push('')
  lines.push('四、迁移前必须确认')
  if (report.warnings.length === 0) {
    lines.push('  未发现明显风险项。')
  }
  else {
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`)
    }
  }
  lines.push('')
  lines.push('五、迁移步骤')
  const steps = options.nextSteps ?? [
    '在目标面板创建实例（不要启动）；',
    '打开「备份与恢复 → 导入存档」，把本压缩包上传，确认识别出的集群后导入；',
    '按目标机器的实际端口核对主世界与洞穴的 6 个 UDP 端口（外部端口必须与内部一致）；',
    '启动实例，等世界就绪后进服确认：能读档、Mod 全部生效、名单正确；',
    '保留本压缩包作为回滚包，确认无误后再清理源机器。',
  ]
  steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step}`)
  })

  if (options.importProbe) {
    lines.push('')
    lines.push('六、导入识别自检（面板导入侧的探测函数）')
    if (options.importProbe.ok) {
      lines.push(`  识别通过：房间名「${options.importProbe.clusterName ?? '未解析'}」，目录 ${options.importProbe.dirName ?? report.dirName}`)
    }
    else {
      lines.push(`  未通过：${options.importProbe.message ?? '未知原因'}`)
      lines.push('  **不要直接导入这份包**，先按上面的分片与端口信息人工核对。')
    }
  }

  lines.push('')
  return `${lines.join('\n')}`
}

/** 包名里去掉文件系统与 URL 上不友好的字符，中文集群名按原样保留 */
export function sanitizeArchiveBaseName(input: string): string {
  return input.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'cluster'
}
