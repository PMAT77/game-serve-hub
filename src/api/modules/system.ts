import api from '../index'

export interface PanelSettingsPayload {
  panelPort: number
  theme: 'light' | 'dark' | 'system'
  autoUpdate: boolean
  checkUpdateBeforeStart: boolean
  updateCheckIntervalHours: number
}

export interface PanelSettingsResponse extends PanelSettingsPayload {
  /** 后端 API 当前监听/映射端口（开发双容器时与浏览器访问端口不同） */
  apiPort: number
}

export interface HubImageUpdateInfoPayload {
  image: string
  tag: string
  releaseVersion: string | null
  localDigest: string | null
  localDigestShort: string | null
  remoteDigest: string | null
  remoteDigestShort: string | null
  updateAvailable: boolean
  localPresent: boolean
  checkError: string | null
}

export interface GitHubReleaseSummaryPayload {
  tagName: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
}

export interface PanelUpdateStatusPayload {
  panel: HubImageUpdateInfoPayload
  dst: HubImageUpdateInfoPayload
  release: GitHubReleaseSummaryPayload | null
  lastCheckedAt: string | null
  checking: boolean
  updating: boolean
  applySupported: boolean
  applyHint: string | null
  manualUpdateCommand: string | null
  checkError: string | null
}

export interface NetworkInterfaceRealtimePayload {
  name: string
  upBps: number
  downBps: number
  totalSentBytes: number
  totalReceivedBytes: number
}

export interface NetworkRealtimePayload {
  timestamp: number
  interfaces: NetworkInterfaceRealtimePayload[]
}

export interface SteamcmdConfigPayload {
  steamcmdPath: string
  installRoot: string
}

export interface SteamcmdConfigResponse extends SteamcmdConfigPayload {
  runtimeMode: 'container'
  steamcmdImage: string
  gameDstImage: string
  isDockerAvailable: boolean
  isSteamcmdInstalled: boolean
  isGameDstImageInstalled: boolean
  detectedSteamcmdPath: string
}

export interface DirectoryItem {
  name: string
  path: string
  type: 'directory' | 'file'
}

export default {
  getSettings: () => api.get('app/system/settings') as Promise<{ data: PanelSettingsResponse }>,
  saveSettings: (data: PanelSettingsPayload) => api.post('app/system/settings', data),
  getSystemInfo: () => api.get('app/system/info'),
  getNetworkRealtime: () => api.get('app/system/network/realtime'),
  getDirectoryList: (directoryPath?: string) => api.get('app/system/filesystem/directories', {
    params: directoryPath ? { path: directoryPath } : undefined,
  }) as Promise<{ data: DirectoryItem[] }>,
  searchDirectoryList: (keyword: string) => api.get('app/system/filesystem/search', {
    params: { keyword },
  }) as Promise<{ data: DirectoryItem[] }>,
  getSteamcmdConfig: () => api.get('app/system/steamcmd/config') as Promise<{ data: SteamcmdConfigResponse }>,
  saveSteamcmdConfig: (data: SteamcmdConfigPayload) => api.post('app/system/steamcmd/config', data),
  installSteamcmd: () => api.post('app/system/steamcmd/install'),
  installGameDstImage: () => api.post('app/system/game-dst/install'),
  getPanelUpdateStatus: () => api.get('app/system/panel-update/status') as Promise<{ data: PanelUpdateStatusPayload }>,
  checkPanelUpdate: () => api.post('app/system/panel-update/check') as Promise<{ data: PanelUpdateStatusPayload }>,
  applyPanelUpdate: (data?: { targets?: Array<'panel' | 'dst'> }) => api.post('app/system/panel-update/apply', data ?? {}) as Promise<{
    data: {
      status: 'updating' | 'completed'
      message: string
      applied: Array<'panel' | 'dst'>
    }
  }>,
}
