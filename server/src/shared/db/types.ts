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
