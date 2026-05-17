import api from '../index'

export interface PanelSettingsPayload {
  panelPort: number
  theme: 'light' | 'dark' | 'system'
  autoUpdate: boolean
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
  isSteamcmdInstalled: boolean
  detectedSteamcmdPath: string
}

export interface DirectoryItem {
  name: string
  path: string
  type: 'directory' | 'file'
}

export default {
  getSettings: () => api.get('app/system/settings'),
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
}
