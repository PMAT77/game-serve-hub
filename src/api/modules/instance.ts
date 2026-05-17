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
  createdAt: string
  updatedAt: string
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

export default {
  getInstanceList: (data?: InstanceListQuery) => api.post('app/instance/list', data),
  getInstallableGames: () => api.get('app/instance/games') as Promise<{ data: InstallableGameItem[] }>,
  getInstanceInstallLog: (id: string) => api.get('app/instance/install-log', {
    params: { id },
  }) as Promise<{ data: InstanceInstallLogPayload }>,
  createInstance: (data: CreateInstancePayload) => api.post('app/instance/create', data),
  startInstance: (id: string) => api.post('app/instance/start', { id }),
  stopInstance: (id: string) => api.post('app/instance/stop', { id }),
  restartInstance: (id: string) => api.post('app/instance/restart', { id }),
  deleteInstance: (id: string) => api.post('app/instance/delete', { id }),
}
