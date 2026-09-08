export interface SessionTokenBundle {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
  accessExpiresInSec: number
  refreshExpiresInSec: number
}

export interface DbSystemNetworkConfig {
  mode: 'bootstrap_pending' | 'managed'
  httpPort: number
  domain: string
  tls: {
    enabled: boolean
    provider: 'none' | 'letsencrypt' | 'custom'
  }
}

export interface DbSystemPanelSettings {
  panelPort: number
  theme: 'light' | 'dark' | 'system'
  autoUpdate: boolean
  /** 启动实例前是否向 Steam 拉取 Build ID 并拦截有更新的启动 */
  checkUpdateBeforeStart: boolean
  /** Hub 镜像自动检查间隔（小时） */
  updateCheckIntervalHours: number
}

export interface DbSystemSteamcmdConfig {
  steamcmdPath: string
  installRoot: string
}

export interface DbSystemBackupSettings {
  /** 每实例存档备份保留上限（含自动钩子备份，0 = 不限制） */
  perInstanceRetention: number
  /** 数据库快照保留上限（0 = 不限制） */
  dbSnapshotRetention: number
  /** 更新服务端前自动备份 */
  autoBackupBeforeUpdate: boolean
  /** 删除实例前自动备份 */
  autoBackupBeforeDelete: boolean
}

export interface DbServerNode {
  id: string
  name: string
  host: string
  sshPort: number
  status: 'online' | 'offline'
  cpuUsage: number
  memoryUsage: number
  diskUsage: number
  lastHeartbeatAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SaveServerNodeInput {
  id: string
  name: string
  host: string
  sshPort?: number
  status?: 'online' | 'offline'
  cpuUsage?: number
  memoryUsage?: number
  diskUsage?: number
  lastHeartbeatAt?: string | null
}

export type DbGameInstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'
export type DbInstallLogStatus = 'running' | 'success' | 'failed'

export interface DbGameInstance {
  id: string
  nodeId: string
  name: string
  gameCode: string
  status: DbGameInstanceStatus
  containerId: string | null
  runtimePid: number | null
  runtimeStartedAt: string | null
  installPath: string | null
  configPath: string | null
  queryPort: number | null
  gamePort: number | null
  rconPort: number | null
  lastCommand: string | null
  lastExitCode: number | null
  lastError: string | null
  installLogStatus: DbInstallLogStatus | null
  installPercent: number | null
  installLogUpdatedAt: string | null
  updateAvailable: boolean
  localBuildId: string | null
  remoteBuildId: string | null
  updateCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateGameInstanceInput {
  id?: string
  nodeId: string
  name: string
  gameCode: string
  status?: DbGameInstanceStatus
  containerId?: string | null
  runtimePid?: number | null
  installPath?: string | null
  configPath?: string | null
  queryPort?: number | null
  gamePort?: number | null
  rconPort?: number | null
  lastCommand?: string | null
  lastExitCode?: number | null
  lastError?: string | null
}

export interface UpdateGameInstanceRuntimeInput {
  status?: DbGameInstanceStatus
  /**
   * 前置状态守卫：仅当当前行 status 命中给定值时才执行更新（状态机竞态保护）。
   * 未命中时静默放弃写入（返回当前行），用于“安装完成/失败只允许覆盖 installing”这类约束。
   */
  whereStatus?: DbGameInstanceStatus | DbGameInstanceStatus[]
  containerId?: string | null
  runtimePid?: number | null
  runtimeStartedAt?: string | null
  gamePort?: number | null
  lastCommand?: string | null
  lastExitCode?: number | null
  lastError?: string | null
  installLogStatus?: DbInstallLogStatus | null
  installPercent?: number | null
  installLogUpdatedAt?: string | null
  updateAvailable?: boolean
  localBuildId?: string | null
  remoteBuildId?: string | null
  updateCheckedAt?: string | null
}

export interface DbInstanceMod {
  id: string
  instanceId: string
  workshopId: string
  name: string
  previewImage: string | null
  enabled: boolean
  loadOrder: number
  version: string | null
  installStatus: 'pending' | 'ready' | 'failed'
  installError: string | null
  /** JSON 序列化的 modoverrides.lua configuration_options；null = 未配置 */
  config: string | null
  createdAt: string
  updatedAt: string
}

export type DbMaintenancePushStatus = 'success' | 'failed'

export interface DbMaintenanceDraft {
  instanceId: string
  message: string
  updatedAt: string
}

export interface DbMaintenancePushLog {
  id: string
  instanceId: string
  message: string
  operatorAccount: string
  status: DbMaintenancePushStatus
  errorMessage: string | null
  pushedAt: string
}

export interface InsertMaintenancePushLogInput {
  instanceId: string
  message: string
  operatorAccount: string
  status: DbMaintenancePushStatus
  errorMessage?: string | null
}

export type DbBackupKind = 'manual' | 'scheduled' | 'pre_update' | 'pre_delete' | 'pre_restore' | 'pre_import' | 'database'
export type DbBackupStatus = 'completed' | 'failed' | 'stale'

export interface DbBackup {
  id: string
  instanceId: string
  filePath: string
  sizeBytes: number
  note: string
  kind: DbBackupKind
  status: DbBackupStatus
  /** JSON 序列化的分片列表（如 ["master","caves"]），数据库快照为 null */
  shards: string | null
  createdBy: string
  createdAt: string
}

export interface CreateBackupInput {
  id: string
  instanceId: string
  filePath: string
  sizeBytes: number
  note?: string
  kind?: DbBackupKind
  status?: DbBackupStatus
  shards?: string | null
  createdBy?: string
}
