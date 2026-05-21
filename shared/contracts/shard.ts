export type ShardId = 'master' | 'caves'

export type ShardContainerStatus = 'running' | 'stopped' | 'not_created' | 'unknown'

export type MasterWorldgenPreset = 'SURVIVAL_TOGETHER'

export type CavesWorldgenPreset = 'DST_CAVE' | 'DST_CAVE_PLUS' | 'COMPLETE_DARKNESS'

export type ShardWorldgenPreset = MasterWorldgenPreset | CavesWorldgenPreset

export type ShardInstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'

export interface ShardSummaryDto {
  id: ShardId
  displayName: string
  configured: boolean
  containerStatus: ShardContainerStatus
  serverPort: number | null
  steamAuthPort: number | null
  steamMasterPort: number | null
  worldgenPreset: ShardWorldgenPreset | null
  /** leveldataoverride.lua 全部 overrides（前端按 tab 拆分） */
  leveldataOverrides: Record<string, string> | null
  /** save 目录已有存档：地图生成详细参数与预设不可再改 */
  worldGenerated: boolean
  isMaster: boolean
  configDirty: boolean
  warnings: string[]
}

export interface ShardListDto {
  instanceId: string
  instanceName: string
  instanceStatus: ShardInstanceStatus
  clusterShardEnabled: boolean
  shards: ShardSummaryDto[]
  effectiveHints: string[]
  warnings: string[]
}

export interface ShardSavePayload {
  instanceId: string
  shard: ShardId
  serverPort: number
  steamAuthPort: number
  steamMasterPort: number
  worldgenPreset: ShardWorldgenPreset
  /** 写入 leveldataoverride.lua overrides（世界规则 tab） */
  worldRuleOverrides?: Record<string, string>
  /** 写入 leveldataoverride.lua overrides（世界生成 tab）；世界已生成时勿传 */
  worldgenOverrides?: Record<string, string>
  restart?: boolean
}

export interface ShardSaveResult {
  saved: true
  restarted: boolean
}

export interface ShardInitCavesResult {
  initialized: boolean
  alreadyConfigured: boolean
  serverPort: number
  steamAuthPort: number
  steamMasterPort: number
  worldgenPreset: CavesWorldgenPreset
}
