export type ClusterNetworkMode = 'offline' | 'lan_only' | 'public'

/** Klei cluster.ini game_mode；暗无天日为官方拼写 darkandwildernes */
export type ClusterGameMode = 'survival' | 'endless' | 'wilderness' | 'easy' | 'darkandwildernes'

export type ClusterIntention = 'cooperative' | 'competitive' | 'social' | 'madness'

export type ClusterInstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'

export interface ClusterConfigDto {
  instanceId: string
  instanceName: string
  instanceStatus: ClusterInstanceStatus
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
  steamGroupId: string
  steamGroupAdmins: boolean
  clusterTokenConfigured: boolean
  /** 已配置时令牌掩码（如 pds-****abcd）；GET 禁止返回明文 */
  clusterTokenMasked: string | null
  configDirty: boolean
  effectiveHints: string[]
  warnings: string[]
}

export interface ClusterSavePayload {
  instanceId: string
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
  steamGroupId: string
  steamGroupAdmins: boolean
  /** 仅公网模式且用户提交新令牌时传入 */
  clusterToken?: string | null
  restart?: boolean
}

export interface ClusterSaveResult {
  saved: true
  restarted: boolean
}

/** GET /app/instance/cluster/online-players 响应体 */
export interface ClusterOnlinePlayersDto {
  instanceId: string
  running: boolean
  /** 实例未运行或查询失败时为 null */
  onlinePlayerCount: number | null
  maxPlayers: number
}
