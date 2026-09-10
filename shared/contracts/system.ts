import { z } from 'zod'

const portSchema = z.number().int().min(1).max(65535)
const trimmedTextSchema = z.string().trim()
const successResultSchema = z.object({
  isSuccess: z.literal(true),
})

export const panelThemeSchema = z.enum(['light', 'dark', 'system'])
export const panelSettingsPayloadSchema = z.object({
  panelPort: portSchema,
  theme: panelThemeSchema,
  autoUpdate: z.boolean(),
  checkUpdateBeforeStart: z.boolean(),
  updateCheckIntervalHours: z.number().int().min(1).max(168),
})
export type PanelSettingsPayload = z.infer<typeof panelSettingsPayloadSchema>

export const panelSettingsRequestSchema = panelSettingsPayloadSchema.partial()
export type PanelSettingsRequest = z.infer<typeof panelSettingsRequestSchema>

export const panelSettingsResponseSchema = panelSettingsPayloadSchema.extend({
  apiPort: portSchema,
})
export type PanelSettingsResponse = z.infer<typeof panelSettingsResponseSchema>

export const directoryItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['directory', 'file']),
})
export type DirectoryItem = z.infer<typeof directoryItemSchema>

export const directoryListQuerySchema = z.object({
  path: trimmedTextSchema.max(2048).optional(),
})
export type DirectoryListQuery = z.infer<typeof directoryListQuerySchema>

export const directorySearchQuerySchema = z.object({
  keyword: trimmedTextSchema.max(64).optional(),
})
export type DirectorySearchQuery = z.infer<typeof directorySearchQuerySchema>

export const steamcmdConfigPayloadSchema = z.object({
  steamcmdPath: trimmedTextSchema.min(1).max(2048),
  installRoot: trimmedTextSchema.min(1).max(2048),
})
export type SteamcmdConfigPayload = z.infer<typeof steamcmdConfigPayloadSchema>

export const steamcmdConfigRequestSchema = steamcmdConfigPayloadSchema.partial()
export type SteamcmdConfigRequest = z.infer<typeof steamcmdConfigRequestSchema>

export const steamcmdConfigResponseSchema = steamcmdConfigPayloadSchema.extend({
  runtimeMode: z.enum(['docker', 'native']),
  runtimeStatus: z.enum(['running', 'stopped']),
  steamcmdImage: z.string(),
  gameDstImage: z.string(),
  isDockerAvailable: z.boolean(),
  isSteamcmdInstalled: z.boolean(),
  isGameDstImageInstalled: z.boolean(),
  detectedSteamcmdPath: z.string(),
  downloadRegion: z.string(),
  networkMode: z.string(),
  installMaxAttempts: z.number().int().positive(),
  httpProxyConfigured: z.boolean(),
  httpsProxyConfigured: z.boolean(),
})
export type SteamcmdConfigResponse = z.infer<typeof steamcmdConfigResponseSchema>

export const networkConfigPayloadSchema = z.object({
  mode: z.enum(['bootstrap_pending', 'managed']),
  httpPort: portSchema,
  domain: trimmedTextSchema.max(253),
  tls: z.object({
    enabled: z.boolean(),
    provider: z.enum(['none', 'letsencrypt', 'custom']),
  }),
})
export type NetworkConfigPayload = z.infer<typeof networkConfigPayloadSchema>

export const networkConfigRequestSchema = z.object({
  mode: networkConfigPayloadSchema.shape.mode.optional(),
  httpPort: networkConfigPayloadSchema.shape.httpPort.optional(),
  domain: networkConfigPayloadSchema.shape.domain.optional(),
  tls: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(['none', 'letsencrypt', 'custom']).optional(),
  }).optional(),
})
export type NetworkConfigRequest = z.infer<typeof networkConfigRequestSchema>

export const networkInterfaceRealtimeSchema = z.object({
  name: z.string(),
  upBps: z.number().nonnegative(),
  downBps: z.number().nonnegative(),
  totalSentBytes: z.number().nonnegative(),
  totalReceivedBytes: z.number().nonnegative(),
})
export type NetworkInterfaceRealtime = z.infer<typeof networkInterfaceRealtimeSchema>

export const networkRealtimeSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  interfaces: z.array(networkInterfaceRealtimeSchema),
})
export type NetworkRealtime = z.infer<typeof networkRealtimeSchema>

const hubImageUpdateInfoSchema = z.object({
  image: z.string(),
  tag: z.string(),
  releaseVersion: z.string().nullable(),
  localDigest: z.string().nullable(),
  localDigestShort: z.string().nullable(),
  remoteDigest: z.string().nullable(),
  remoteDigestShort: z.string().nullable(),
  updateAvailable: z.boolean(),
  localPresent: z.boolean(),
  checkError: z.string().nullable(),
})
export type HubImageUpdateInfo = z.infer<typeof hubImageUpdateInfoSchema>

const gitHubReleaseSummarySchema = z.object({
  tagName: z.string(),
  name: z.string(),
  body: z.string(),
  publishedAt: z.string(),
  htmlUrl: z.string(),
})
export type GitHubReleaseSummary = z.infer<typeof gitHubReleaseSummarySchema>

export const panelUpdateStatusSchema = z.object({
  runtimeMode: z.enum(['docker', 'native']),
  /** v0.2.0 起统一镜像：面板/DST/SteamCMD 共用同一镜像，单一更新目标 */
  image: hubImageUpdateInfoSchema,
  release: gitHubReleaseSummarySchema.nullable(),
  lastCheckedAt: z.string().nullable(),
  checking: z.boolean(),
  updating: z.boolean(),
  applySupported: z.boolean(),
  imageApplySupported: z.boolean(),
  applyHint: z.string().nullable(),
  /** 更新语义分类：无更新 / 版本更高 / 版本号相同但镜像内容不同 / 有更新但读不到版本号 */
  updateKind: z.enum(['none', 'newer', 'same-version-changed', 'unknown']),
  manualUpdateCommand: z.string().nullable(),
  checkError: z.string().nullable(),
})
export type PanelUpdateStatus = z.infer<typeof panelUpdateStatusSchema>

export const panelUpdateApplyRequestSchema = z.object({}).strict()
export type PanelUpdateApplyRequest = z.infer<typeof panelUpdateApplyRequestSchema>

export const panelUpdateApplyResponseSchema = z.object({
  status: z.enum(['updating', 'completed']),
  message: z.string(),
})
export type PanelUpdateApplyResponse = z.infer<typeof panelUpdateApplyResponseSchema>

export const systemSuccessResponseSchema = successResultSchema
export type SystemSuccessResponse = z.infer<typeof systemSuccessResponseSchema>
