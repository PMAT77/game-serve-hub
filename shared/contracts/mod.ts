import { z } from 'zod'
import { instanceIdSchema } from './instance'

export type ModInstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'

export type ModInstallStatus = 'pending' | 'ready' | 'failed'

export interface ModItemDto {
  id: string
  workshopId: string
  name: string
  previewImage: string | null
  /** Steam 评价 0–5 星；无数据时为 null */
  rating: number | null
  enabled: boolean
  loadOrder: number
  version: string | null
  installStatus: ModInstallStatus
  installError: string | null
  dependencyIds: string[]
  missingDependencyIds: string[]
  dependentModIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ModListDto {
  instanceId: string
  instanceName: string
  instanceStatus: ModInstanceStatus
  riskTip: string | null
  mods: ModItemDto[]
  /** 内存中仍在进行的下载任务（含 phase） */
  activeInstallJobs: ModInstallJobDto[]
}

export interface ModInstallPayload {
  workshopId: string
  name?: string
  previewImage?: string
  version?: string
  enabled?: boolean
  dependencyIds?: string[]
}

export interface ModUpdatePayload {
  enabled?: boolean
  name?: string
  version?: string
  dependencyIds?: string[]
}

export interface ModReorderPayload {
  workshopIds: string[]
}

export interface ModMutationResult {
  saved: true
  riskTip: string | null
  mod: ModItemDto
}

export type ModInstallJobStatus = 'downloading' | 'success' | 'failed' | 'not_found'

export type ModInstallJobPhase = 'waiting_steamcmd' | 'downloading'

export interface ModInstallJobDto {
  instanceId: string
  workshopId: string
  status: ModInstallJobStatus
  phase: ModInstallJobPhase | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  mod?: ModItemDto
}

export interface ModReorderResult {
  saved: true
  riskTip: string | null
  mods: ModItemDto[]
}

export interface ModDeleteResult {
  deleted: true
  riskTip: string | null
}

export interface SteamModListQueryResultItem {
  workshopId: string
  title: string
  previewImage: string | null
  detailUrl: string
  /** Steam 评价 0–5 星；无数据时为 null */
  rating: number | null
  /** 实例内存在订阅记录（含 pending/failed/ready） */
  subscribed: boolean
  /** 未订阅时为 null */
  subscribeStatus: ModInstallStatus | null
  /** 文件已就绪（installStatus=ready）；与 subscribeStatus 区分 */
  installed: boolean
  /** 已发起订阅但文件尚未就绪（DB pending 或 job downloading） */
  pendingDownload: boolean
}

export const MOD_CONTENT_LOCALES = ['zh-CN', 'en-US'] as const
export type ModContentLocale = (typeof MOD_CONTENT_LOCALES)[number]
export const DEFAULT_MOD_CONTENT_LOCALE: ModContentLocale = 'zh-CN'
export type ModLocalizedTextMap = Partial<Record<ModContentLocale, string>>

export function resolveModLocalizedText(
  map: ModLocalizedTextMap,
  preferredLocale: ModContentLocale,
): { value: string, contentLocale: ModContentLocale } {
  const fallbackLocale: ModContentLocale = preferredLocale === 'zh-CN' ? 'en-US' : 'zh-CN'
  const order: ModContentLocale[] = [preferredLocale, fallbackLocale]
  for (const locale of order) {
    const value = map[locale]?.trim()
    if (value) {
      return { value, contentLocale: locale }
    }
  }
  for (const locale of MOD_CONTENT_LOCALES) {
    const value = map[locale]?.trim()
    if (value) {
      return { value, contentLocale: locale }
    }
  }
  return { value: '', contentLocale: preferredLocale }
}

export interface SteamModDetailDto {
  workshopId: string
  /** 当前 locale 下解析后的展示标题 */
  title: string
  /** 当前 locale 下解析后的展示描述 */
  description: string
  /** 实际用于解析 title/description 的 locale */
  contentLocale: ModContentLocale
  /** 多语言标题，供 i18n 切换 */
  titles: ModLocalizedTextMap
  /** 多语言描述，供 i18n 切换 */
  descriptions: ModLocalizedTextMap
  previewImage: string | null
  /** 字节数；未知时为 null */
  fileSize: number | null
  tags: string[]
  /** ISO8601；未知时为 null */
  publishedAt: string | null
  /** ISO8601；未知时为 null */
  updatedAt: string | null
  detailUrl: string
  /** 实例内存在订阅记录（含 pending/failed/ready） */
  subscribed: boolean
  /** 未订阅时为 null */
  subscribeStatus: ModInstallStatus | null
  /** 文件已就绪（installStatus=ready） */
  installed: boolean
  /** 创作者显示名；无法解析时为 null */
  creatorName: string | null
}

export type SteamModSort = 'trend' | 'mostrecent' | 'relevance' | 'totaluniquesubscribers'

/** 仅在 sort=trend（最热门）时生效 */
export type SteamModTrendDays = 1 | 7 | 30 | 90 | 180 | 365 | -1

export interface SteamModListQueryResult {
  keyword: string
  page: number
  pageSize: number
  sort: SteamModSort
  trendDays: SteamModTrendDays
  hasMore: boolean
  /** 上游返回的总条数；未知时为 null */
  totalCount: number | null
  /** 上游返回的总页数；未知时为 null */
  totalPages: number | null
  sourceUrl: string
  meta: SteamModListMeta
  items: SteamModListQueryResultItem[]
  /** 当前实例正在下载中的 Workshop ID */
  pendingWorkshopIds: string[]
}

export type SteamModFetchSource = 'live' | 'cache-fresh' | 'cache-stale'
export type SteamModUpstreamSource = 'official' | 'relay' | 'html'

export type SteamModFetchErrorCode =
  | 'STEAM_TIMEOUT'
  | 'STEAM_RATE_LIMIT'
  | 'STEAM_PARSE_FAILED'
  | 'STEAM_UPSTREAM_UNAVAILABLE'

export interface SteamModListMeta {
  cached: boolean
  stale: boolean
  cacheAgeMs: number
  source: SteamModFetchSource
  upstreamSource: SteamModUpstreamSource
  lastSuccessSource?: SteamModUpstreamSource
  lastSuccessAt?: string
  retryAfterMs?: number
  fetchTraceId: string
  /** live 拉取失败且无缓存时的降级标记 */
  upstreamUnavailable?: boolean
  /** 降级时的友好提示，供前端 inline 展示 */
  upstreamMessage?: string
  steamErrorCode?: SteamModFetchErrorCode
}

const workshopIdSchema = z.string().trim().min(1).max(64)
const optionalTextSchema = z.string().trim().max(512).optional()

export const modInstanceParamsSchema = z.object({
  instanceId: instanceIdSchema,
})
export type ModInstanceParams = z.infer<typeof modInstanceParamsSchema>

export const modItemParamsSchema = modInstanceParamsSchema.extend({
  modId: workshopIdSchema,
})
export type ModItemParams = z.infer<typeof modItemParamsSchema>

export const modWorkshopParamsSchema = modInstanceParamsSchema.extend({
  workshopId: workshopIdSchema,
})
export type ModWorkshopParams = z.infer<typeof modWorkshopParamsSchema>

export const modListQuerySchema = z.object({
  enrich: z.string().trim().max(128).optional(),
})
export type ModListQuery = z.infer<typeof modListQuerySchema>

const queryNumberSchema = z.union([z.string().trim().max(16), z.number().finite()]).optional()

export const steamModListQuerySchema = z.object({
  keyword: z.string().trim().max(256).optional(),
  page: queryNumberSchema,
  pageSize: queryNumberSchema,
  sort: z.string().trim().max(64).optional(),
  trendDays: queryNumberSchema,
})
export type SteamModListQuery = z.infer<typeof steamModListQuerySchema>

export const steamModDetailQuerySchema = z.object({
  locale: z.string().trim().max(16).optional(),
})
export type SteamModDetailQuery = z.infer<typeof steamModDetailQuerySchema>

export const modInstallPayloadSchema = z.object({
  workshopId: workshopIdSchema,
  name: optionalTextSchema,
  previewImage: z.string().trim().max(2048).optional(),
  version: optionalTextSchema,
  enabled: z.boolean().optional(),
  dependencyIds: z.array(workshopIdSchema).max(128).optional(),
})

export const modUpdatePayloadSchema = z.object({
  enabled: z.boolean().optional(),
  name: optionalTextSchema,
  version: optionalTextSchema,
  dependencyIds: z.array(workshopIdSchema).max(128).optional(),
})

export const modReorderPayloadSchema = z.object({
  workshopIds: z.array(workshopIdSchema).max(512),
})

export const modInstallJobsQuerySchema = z.object({
  workshopIds: z.union([
    z.string().trim().max(16_384),
    z.array(workshopIdSchema).max(512),
  ]).optional(),
})
