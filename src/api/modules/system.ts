import type {
  DirectoryItem,
  NetworkConfigPayload,
  NetworkRealtime,
  PanelSettingsPayload,
  PanelSettingsResponse,
  PanelUpdateApplyRequest,
  PanelUpdateApplyResponse,
  PanelUpdateStatus,
  SteamcmdConfigPayload,
  SteamcmdConfigResponse,
  SystemSuccessResponse,
} from '../../../shared/contracts/system'
import api from '../index'

export type {
  DirectoryItem,
  NetworkConfigPayload,
  NetworkRealtime,
  PanelSettingsPayload,
  PanelSettingsResponse,
  PanelUpdateApplyRequest,
  PanelUpdateApplyResponse,
  PanelUpdateStatus,
  SteamcmdConfigPayload,
  SteamcmdConfigResponse,
}

export default {
  getSettings: () => api.get('app/system/settings') as Promise<{ data: PanelSettingsResponse }>,
  saveSettings: (data: PanelSettingsPayload) => api.post('app/system/settings', data) as Promise<{
    data: SystemSuccessResponse
  }>,
  getSystemInfo: () => api.get('app/system/info'),
  getNetworkRealtime: () => api.get('app/system/network/realtime') as Promise<{ data: NetworkRealtime }>,
  getDirectoryList: (directoryPath?: string) => api.get('app/system/filesystem/directories', {
    params: directoryPath ? { path: directoryPath } : undefined,
  }) as Promise<{ data: DirectoryItem[] }>,
  searchDirectoryList: (keyword: string) => api.get('app/system/filesystem/search', {
    params: { keyword },
  }) as Promise<{ data: DirectoryItem[] }>,
  getSteamcmdConfig: () => api.get('app/system/steamcmd/config') as Promise<{ data: SteamcmdConfigResponse }>,
  saveSteamcmdConfig: (data: SteamcmdConfigPayload) => api.post('app/system/steamcmd/config', data) as Promise<{
    data: SystemSuccessResponse
  }>,
  installSteamcmd: () => api.post('app/system/steamcmd/install'),
  installGameDstImage: () => api.post('app/system/game-dst/install'),
  getPanelUpdateStatus: () => api.get('app/system/panel-update/status') as Promise<{ data: PanelUpdateStatus }>,
  checkPanelUpdate: () => api.post('app/system/panel-update/check') as Promise<{ data: PanelUpdateStatus }>,
  applyPanelUpdate: (data?: PanelUpdateApplyRequest) => api.post('app/system/panel-update/apply', data ?? {}) as Promise<{
    data: PanelUpdateApplyResponse
  }>,
}
