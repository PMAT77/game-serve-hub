import api from '../index'

export type InstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'

export interface InstanceItem {
  id: string
  nodeId: string
  name: string
  gameCode: string
  status: InstanceStatus
  containerId: string | null
  installPath: string | null
  configPath: string | null
  queryPort: number | null
  gamePort: number | null
  rconPort: number | null
  lastCommand: string | null
  lastError: string | null
  installLogStatus: 'running' | 'success' | 'failed' | null
  installPercent: number | null
  installLogUpdatedAt: string | null
  updateAvailable: boolean
  localBuildId: string | null
  remoteBuildId: string | null
  updateCheckedAt: string | null
  runtimeStartedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface InstanceRuntimeMetrics {
  cpuUsageRate: number | null
  memoryMb: number | null
  uptimeSeconds: number | null
}

export interface InstanceMetricsPayload {
  items: Record<string, InstanceRuntimeMetrics | null>
  collectedAt: string
}

export interface InstanceCheckUpdatesPayload {
  items: Array<{
    id: string
    name: string
    updateAvailable: boolean
    localBuildId: string | null
    remoteBuildId: string | null
    updateCheckedAt: string | null
    message?: string
  }>
  updateAvailableCount: number
}

export interface InstanceListQuery {
  nodeId?: string
  status?: InstanceStatus
  keyword?: string
}

export interface CreateInstancePayload {
  nodeId: string
  name: string
  gameCode: string
  installPath?: string
  configPath?: string
  queryPort?: number
  gamePort?: number
  rconPort?: number
}

export interface InstallableGameItem {
  appId: string
  name: string
}

/** install_log：内存中的完整 SteamCMD 输出；status_summary：仅 lastCommand/lastError 摘要；empty：无可用内容 */
export type InstanceInstallLogSource = 'install_log' | 'status_summary' | 'empty'

export interface InstanceInstallLogPayload {
  content: string
  status: 'success' | 'failed' | 'running' | 'unknown'
  updatedAt: string | null
  source: InstanceInstallLogSource
}

export type InstanceConsoleLogStream = 'stdout' | 'stderr' | 'system'

export interface InstanceConsoleLogLine {
  id: number
  stream: InstanceConsoleLogStream
  text: string
  at: string
}

export interface InstanceConsoleLogsPayload {
  lines: InstanceConsoleLogLine[]
  running: boolean
}

export default {
  getInstanceList: (data?: InstanceListQuery) => api.post('app/instance/list', data),
  getInstanceMetrics: (ids?: string[]) => api.post('app/instance/metrics', ids?.length ? { ids } : {}) as Promise<{ data: InstanceMetricsPayload }>,
  getInstallableGames: () => api.get('app/instance/games') as Promise<{ data: InstallableGameItem[] }>,
  getInstanceInstallLog: (id: string) => api.get('app/instance/install-log', {
    params: { id },
  }) as Promise<{ data: InstanceInstallLogPayload }>,
  createInstance: (data: CreateInstancePayload) => api.post('app/instance/create', data),
  updateInstance: (id: string, options?: { force?: boolean }) => api.post('app/instance/update', { id, force: options?.force }),
  checkInstanceUpdates: (ids?: string[]) => api.post('app/instance/check-updates', ids?.length ? { ids } : {}) as Promise<{ data: InstanceCheckUpdatesPayload }>,
  startInstance: (id: string) => api.post('app/instance/start', { id }),
  stopInstance: (id: string) => api.post('app/instance/stop', { id }),
  restartInstance: (id: string) => api.post('app/instance/restart', { id }),
  deleteInstance: (id: string) => api.post('app/instance/delete', { id }),
  getInstanceConsoleLogs: (instanceId: string, afterId = 0) => api.get('app/instance/console/logs', {
    params: { instanceId, afterId },
  }) as Promise<{ data: InstanceConsoleLogsPayload }>,
  clearInstanceConsoleLogs: (instanceId: string) => api.post('app/instance/console/logs/clear', { instanceId }),
  sendInstanceConsoleCommand: (instanceId: string, command: string) => api.post('app/instance/console/command', {
    instanceId,
    command,
  }),
  buildInstanceConsoleStreamUrl(instanceId: string, token: string) {
    const prefix = (import.meta.env.DEV && import.meta.env.VITE_ENABLE_PROXY)
      ? '/proxy/'
      : import.meta.env.VITE_APP_API_BASEURL
    const base = prefix.endsWith('/') ? prefix : `${prefix}/`
    const params = new URLSearchParams({ instanceId, token })
    return `${base}app/instance/console/stream?${params.toString()}`
  },
}
