import type {
  ClusterGameMode,
  ClusterIntention,
  ClusterNetworkMode,
  ClusterSavePayload,
} from '../../../../../shared/contracts/cluster'

export interface ClusterIniFields {
  networkMode: ClusterNetworkMode
  clusterName: string
  clusterDescription: string
  clusterPassword: string
  gameMode: ClusterGameMode
  maxPlayers: number
  pvp: boolean
  pauseWhenEmpty: boolean
  voteEnabled: boolean
  clusterIntention: ClusterIntention
  tickRate: number
  maxSnapshots: number
  shardEnabled: boolean
  bindIp: string
  masterIp: string
  masterPort: number
  clusterKey: string
  steamGroupOnly: boolean
  /** Steam 组 ID：ini 中为纯数字字面量，0 表示未设置 */
  steamGroupId: string
  steamGroupAdmins: boolean
}

const VALID_GAME_MODES: ClusterGameMode[] = ['survival', 'endless', 'wilderness', 'easy', 'darkandwildernes']
const VALID_CLUSTER_INTENTIONS: ClusterIntention[] = ['cooperative', 'competitive', 'social', 'madness']

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return fallback
}

function parseIni(content: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let currentSection = ''
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim().toUpperCase()
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map())
      }
      continue
    }
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }
    const key = line.slice(0, eqIndex).trim()
    const value = line.slice(eqIndex + 1).trim()
    if (!sections.has(currentSection)) {
      sections.set(currentSection, new Map())
    }
    sections.get(currentSection)!.set(key, value)
  }
  return sections
}

function getSectionValue(sections: Map<string, Map<string, string>>, section: string, key: string): string | undefined {
  return sections.get(section.toUpperCase())?.get(key)
}

export function deriveNetworkMode(offlineCluster: boolean, lanOnlyCluster: boolean): {
  networkMode: ClusterNetworkMode
  warning?: string
} {
  if (offlineCluster && lanOnlyCluster) {
    return {
      networkMode: 'offline',
      warning: 'cluster.ini 中 offline_cluster 与 lan_only_cluster 同时为 true，已按离线模式处理',
    }
  }
  if (offlineCluster) {
    return { networkMode: 'offline' }
  }
  if (lanOnlyCluster) {
    return { networkMode: 'lan_only' }
  }
  return { networkMode: 'public' }
}

export function networkModeToIniFlags(networkMode: ClusterNetworkMode): {
  offline_cluster: boolean
  lan_only_cluster: boolean
} {
  switch (networkMode) {
    case 'offline':
      return { offline_cluster: true, lan_only_cluster: false }
    case 'lan_only':
      return { offline_cluster: false, lan_only_cluster: true }
    case 'public':
      return { offline_cluster: false, lan_only_cluster: false }
  }
}

function parseIntField(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseClusterIni(content: string): {
  fields: ClusterIniFields
  warnings: string[]
} {
  const sections = parseIni(content)
  const warnings: string[] = []
  const offlineCluster = parseBool(getSectionValue(sections, 'NETWORK', 'offline_cluster'), true)
  const lanOnlyCluster = parseBool(getSectionValue(sections, 'NETWORK', 'lan_only_cluster'), false)
  const { networkMode, warning } = deriveNetworkMode(offlineCluster, lanOnlyCluster)
  if (warning) {
    warnings.push(warning)
  }

  const rawGameMode = getSectionValue(sections, 'GAMEPLAY', 'game_mode') ?? 'survival'
  const gameMode = VALID_GAME_MODES.includes(rawGameMode as ClusterGameMode)
    ? rawGameMode as ClusterGameMode
    : 'survival'

  const rawIntention = getSectionValue(sections, 'NETWORK', 'cluster_intention') ?? 'cooperative'
  const clusterIntention = VALID_CLUSTER_INTENTIONS.includes(rawIntention as ClusterIntention)
    ? rawIntention as ClusterIntention
    : 'cooperative'

  return {
    fields: {
      networkMode,
      clusterName: getSectionValue(sections, 'NETWORK', 'cluster_name') ?? 'Game Server Hub',
      clusterDescription: getSectionValue(sections, 'NETWORK', 'cluster_description') ?? '',
      clusterPassword: getSectionValue(sections, 'NETWORK', 'cluster_password') ?? '',
      gameMode,
      maxPlayers: parseIntField(getSectionValue(sections, 'GAMEPLAY', 'max_players'), 6),
      pvp: parseBool(getSectionValue(sections, 'GAMEPLAY', 'pvp'), false),
      pauseWhenEmpty: parseBool(getSectionValue(sections, 'GAMEPLAY', 'pause_when_empty'), true),
      voteEnabled: parseBool(getSectionValue(sections, 'GAMEPLAY', 'vote_enabled'), true),
      clusterIntention,
      tickRate: parseIntField(getSectionValue(sections, 'NETWORK', 'tick_rate'), 15),
      maxSnapshots: parseIntField(getSectionValue(sections, 'MISC', 'max_snapshots'), 6),
      shardEnabled: parseBool(getSectionValue(sections, 'SHARD', 'shard_enabled'), false),
      bindIp: getSectionValue(sections, 'SHARD', 'bind_ip') ?? '127.0.0.1',
      masterIp: getSectionValue(sections, 'SHARD', 'master_ip') ?? '127.0.0.1',
      masterPort: parseIntField(getSectionValue(sections, 'SHARD', 'master_port'), 10888),
      clusterKey: getSectionValue(sections, 'SHARD', 'cluster_key') ?? 'supersecretkey',
      steamGroupOnly: parseBool(getSectionValue(sections, 'STEAM', 'steam_group_only'), false),
      steamGroupId: normalizeSteamGroupId(getSectionValue(sections, 'STEAM', 'steam_group_id')),
      steamGroupAdmins: parseBool(getSectionValue(sections, 'STEAM', 'steam_group_admins'), false),
    },
    warnings,
  }
}

function sanitizeInlineText(value: string): string {
  return value.replace(/[\r\n"]/g, ' ').trim()
}

/** Klei cluster.ini：steam_group_id 为纯数字，0 表示未关联 Steam 组 */
export function normalizeSteamGroupId(value: string | undefined): string {
  const raw = value?.trim() ?? ''
  return raw || '0'
}

function isValidSteamGroupId(value: string): boolean {
  return /^\d+$/.test(value)
}

/** 结构与 docs/others/cluster.ini 一致（无注释行） */
export function buildClusterIni(fields: ClusterIniFields): string {
  const safeClusterName = sanitizeInlineText(fields.clusterName) || 'Game Server Hub'
  const safeDescription = sanitizeInlineText(fields.clusterDescription)
  const safePassword = sanitizeInlineText(fields.clusterPassword)
  const safeBindIp = sanitizeInlineText(fields.bindIp) || '127.0.0.1'
  const safeMasterIp = sanitizeInlineText(fields.masterIp) || '127.0.0.1'
  const safeClusterKey = sanitizeInlineText(fields.clusterKey) || 'supersecretkey'
  const { offline_cluster, lan_only_cluster } = networkModeToIniFlags(fields.networkMode)

  return [
    '[GAMEPLAY]',
    `game_mode = ${fields.gameMode}`,
    `max_players = ${fields.maxPlayers}`,
    `pvp = ${fields.pvp}`,
    `pause_when_empty = ${fields.pauseWhenEmpty}`,
    `vote_enabled = ${fields.voteEnabled}`,
    '',
    '[NETWORK]',
    `cluster_name = ${safeClusterName}`,
    `cluster_description = ${safeDescription}`,
    `cluster_password = ${safePassword}`,
    `cluster_intention = ${fields.clusterIntention}`,
    `lan_only_cluster = ${lan_only_cluster}`,
    `offline_cluster = ${offline_cluster}`,
    `tick_rate = ${fields.tickRate}`,
    'whitelist_slots = 0',
    '',
    '[MISC]',
    'console_enabled = true',
    `max_snapshots = ${fields.maxSnapshots}`,
    '',
    '[SHARD]',
    `shard_enabled = ${fields.shardEnabled}`,
    `bind_ip = ${safeBindIp}`,
    `master_ip = ${safeMasterIp}`,
    `master_port = ${fields.masterPort}`,
    `cluster_key = ${safeClusterKey}`,
    '',
    '[STEAM]',
    `steam_group_only = ${fields.steamGroupOnly}`,
    `steam_group_id = ${normalizeSteamGroupId(fields.steamGroupId)}`,
    `steam_group_admins = ${fields.steamGroupAdmins}`,
    '',
  ].join('\n')
}

export function validateClusterFields(fields: ClusterIniFields): string[] {
  const errors: string[] = []
  if (!sanitizeInlineText(fields.clusterName)) {
    errors.push('房间名称不能为空')
  }
  if (!VALID_GAME_MODES.includes(fields.gameMode)) {
    errors.push('游戏模式无效')
  }
  if (!Number.isInteger(fields.maxPlayers) || fields.maxPlayers < 1 || fields.maxPlayers > 64) {
    errors.push('最大玩家数须在 1–64 之间')
  }
  if (!Number.isInteger(fields.tickRate) || fields.tickRate < 15 || fields.tickRate > 60) {
    errors.push('网络刷新率须在 15–60 之间')
  }
  if (!Number.isInteger(fields.maxSnapshots) || fields.maxSnapshots < 1) {
    errors.push('最大快照数须为正整数')
  }
  if (fields.shardEnabled) {
    if (!sanitizeInlineText(fields.bindIp)) {
      errors.push('分片 bind_ip 不能为空')
    }
    if (!sanitizeInlineText(fields.masterIp)) {
      errors.push('分片 master_ip 不能为空')
    }
    if (!Number.isInteger(fields.masterPort) || fields.masterPort < 1 || fields.masterPort > 65535) {
      errors.push('分片 master_port 须在 1–65535 之间')
    }
    if (!sanitizeInlineText(fields.clusterKey)) {
      errors.push('启用分片时 cluster_key 不能为空')
    }
  }
  const steamGroupId = normalizeSteamGroupId(fields.steamGroupId)
  if (!isValidSteamGroupId(steamGroupId)) {
    errors.push('Steam 组 ID 只能包含数字')
  }
  if (fields.steamGroupOnly && steamGroupId === '0') {
    errors.push('启用仅 Steam 组入服时须填写有效的 Steam 组 ID')
  }
  return errors
}

export function payloadToIniFields(payload: Omit<ClusterSavePayload, 'instanceId' | 'restart' | 'clusterToken'>): ClusterIniFields {
  return {
    networkMode: payload.networkMode,
    clusterName: payload.clusterName,
    clusterDescription: payload.clusterDescription,
    clusterPassword: payload.clusterPassword,
    gameMode: payload.gameMode,
    maxPlayers: payload.maxPlayers,
    pvp: payload.pvp,
    pauseWhenEmpty: payload.pauseWhenEmpty,
    voteEnabled: payload.voteEnabled,
    clusterIntention: payload.clusterIntention,
    tickRate: payload.tickRate,
    maxSnapshots: payload.maxSnapshots,
    shardEnabled: payload.shardEnabled,
    bindIp: payload.bindIp,
    masterIp: payload.masterIp,
    masterPort: payload.masterPort,
    clusterKey: payload.clusterKey,
    steamGroupOnly: payload.steamGroupOnly,
    steamGroupId: payload.steamGroupId,
    steamGroupAdmins: payload.steamGroupAdmins,
  }
}

export function defaultClusterIniFields(instanceName?: string): ClusterIniFields {
  return {
    networkMode: 'offline',
    clusterName: instanceName?.trim() || 'Game Server Hub',
    clusterDescription: 'Generated by Game Server Hub',
    clusterPassword: '',
    gameMode: 'survival',
    maxPlayers: 6,
    pvp: false,
    pauseWhenEmpty: true,
    voteEnabled: true,
    clusterIntention: 'cooperative',
    tickRate: 15,
    maxSnapshots: 6,
    shardEnabled: false,
    bindIp: '127.0.0.1',
    masterIp: '127.0.0.1',
    masterPort: 10888,
    clusterKey: 'supersecretkey',
    steamGroupOnly: false,
    steamGroupId: '0',
    steamGroupAdmins: false,
  }
}
