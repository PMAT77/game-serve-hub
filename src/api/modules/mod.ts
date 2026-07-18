import type {
  ModDeleteResult,
  ModInstallJobDto,
  ModInstallPayload,
  ModListDto,
  ModMutationResult,
  ModReorderPayload,
  ModReorderResult,
  SteamModListQueryResult,
  SteamModDetailDto,
  ModContentLocale,
  SteamModSort,
  SteamModTrendDays,
  ModUpdatePayload,
} from '../../../shared/contracts/mod'
import api from '../index'

export type {
  ModDeleteResult,
  ModInstallJobDto,
  ModInstallJobPhase,
  ModInstallJobStatus,
  ModInstallPayload,
  ModInstallStatus,
  ModItemDto,
  ModListDto,
  ModMutationResult,
  ModReorderPayload,
  ModReorderResult,
  SteamModListQueryResultItem,
  SteamModListMeta,
  SteamModListQueryResult,
  SteamModDetailDto,
  ModContentLocale,
  SteamModSort,
  SteamModTrendDays,
  ModUpdatePayload,
} from '../../../shared/contracts/mod'

const MOD_INSTALL_JOB_POLL_INTERVAL_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isModInstallJobTerminal(status: ModInstallJobDto['status']): boolean {
  return status === 'success' || status === 'failed' || status === 'not_found'
}

export default {
  getModList: (instanceId: string, options?: { enrich?: string }) =>
    api.get(`app/instances/${instanceId}/mods`, {
      params: options?.enrich ? { enrich: options.enrich } : undefined,
    }) as Promise<{ data: ModListDto }>,
  getSteamModList: (
    instanceId: string,
    params?: {
      keyword?: string
      page?: number
      pageSize?: number
      sort?: SteamModSort
      trendDays?: SteamModTrendDays
    },
    options?: {
      signal?: AbortSignal
    },
  ) => api.get(`app/instances/${instanceId}/mods/steam`, {
    params,
    signal: options?.signal,
  }) as Promise<{ data: SteamModListQueryResult }>,
  getSteamModDetail: (
    instanceId: string,
    workshopId: string,
    options?: { locale?: ModContentLocale },
  ) => api.get(`app/instances/${instanceId}/mods/steam/${workshopId}`, {
    params: options?.locale ? { locale: options.locale } : undefined,
  }) as Promise<{ data: SteamModDetailDto }>,
  installMod: (instanceId: string, payload: ModInstallPayload) =>
    api.post(`app/instances/${instanceId}/mods/install`, payload) as Promise<{ data: ModInstallJobDto }>,
  getModInstallJob: (instanceId: string, workshopId: string) =>
    api.get(`app/instances/${instanceId}/mods/install-jobs/${workshopId}`) as Promise<{ data: ModInstallJobDto }>,
  listModInstallJobs: (instanceId: string, workshopIds?: string[]) =>
    api.get(`app/instances/${instanceId}/mods/install-jobs`, {
      params: workshopIds?.length ? { workshopIds: workshopIds.join(',') } : undefined,
    }) as Promise<{ data: ModInstallJobDto[] }>,
  pollModInstallJob: async (
    instanceId: string,
    workshopId: string,
    options?: {
      intervalMs?: number
      onUpdate?: (job: ModInstallJobDto) => void
    },
  ): Promise<ModInstallJobDto> => {
    const intervalMs = options?.intervalMs ?? MOD_INSTALL_JOB_POLL_INTERVAL_MS
    while (true) {
      const { data } = await api.get(`app/instances/${instanceId}/mods/install-jobs/${workshopId}`) as { data: ModInstallJobDto }
      options?.onUpdate?.(data)
      if (isModInstallJobTerminal(data.status)) {
        return data
      }
      await sleep(intervalMs)
    }
  },
  updateMod: (instanceId: string, modId: string, payload: ModUpdatePayload) =>
    api.put(`app/instances/${instanceId}/mods/${modId}`, payload) as Promise<{ data: ModMutationResult }>,
  reorderMods: (instanceId: string, payload: ModReorderPayload) =>
    api.put(`app/instances/${instanceId}/mods/reorder`, payload) as Promise<{ data: ModReorderResult }>,
  deleteMod: (instanceId: string, modId: string) =>
    api.delete(`app/instances/${instanceId}/mods/${modId}`) as Promise<{ data: ModDeleteResult }>,
}
