import type {
  DirectoryItem,
  NetworkConfigPayload,
  NetworkRealtime,
  PanelPortSync,
  PanelSettingsPayload,
  PanelSettingsResponse,
  PanelSettingsSaveResponse,
  PanelUpdateApplyRequest,
  PanelUpdateApplyResponse,
  PanelUpdateStatus,
  SteamcmdConfigResponse,
  SelfCheckItem,
  SelfCheckReport,
  SelfCheckStatus,
} from '../../../shared/contracts/system'
import api from '../index'

export type {
  DirectoryItem,
  NetworkConfigPayload,
  NetworkRealtime,
  PanelPortSync,
  PanelSettingsPayload,
  PanelSettingsResponse,
  PanelSettingsSaveResponse,
  PanelUpdateApplyRequest,
  PanelUpdateApplyResponse,
  PanelUpdateStatus,
  SelfCheckItem,
  SelfCheckReport,
  SelfCheckStatus,
  SteamcmdConfigResponse,
}

export default {
  getSettings: () => api.get('app/system/settings') as Promise<{ data: PanelSettingsResponse }>,
  saveSettings: (data: PanelSettingsPayload) => api.post('app/system/settings', data) as Promise<{
    data: PanelSettingsSaveResponse
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
  // 没有 saveSteamcmdConfig：`POST app/system/steamcmd/config` 会用服务端配置覆盖请求体里的
  // steamcmdPath 与 installRoot（见 server/src/modules/system/index.ts），从这里发出去只会得到
  // 「保存成功但数值不变」。SteamCMD 面板内配置保持只读，要让它可写需先改后端不再覆盖请求体。
  installSteamcmd: () => api.post('app/system/steamcmd/install'),
  installGameDstImage: () => api.post('app/system/game-dst/install'),
  getPanelUpdateStatus: () => api.get('app/system/panel-update/status') as Promise<{ data: PanelUpdateStatus }>,
  getSelfCheck: () => api.get('app/system/self-check') as Promise<{ data: SelfCheckReport }>,
  checkPanelUpdate: () => api.post('app/system/panel-update/check') as Promise<{ data: PanelUpdateStatus }>,
  applyPanelUpdate: (data?: PanelUpdateApplyRequest) => api.post('app/system/panel-update/apply', data ?? {}) as Promise<{
    data: PanelUpdateApplyResponse
  }>,
}
