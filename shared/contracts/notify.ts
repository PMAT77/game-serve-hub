import { z } from 'zod'

/** 通知渠道类型（国内直连可达优先） */
export const notifyChannelTypeSchema = z.enum(['dingtalk', 'wecom', 'feishu', 'serverchan', 'pushplus'])
export type NotifyChannelType = z.infer<typeof notifyChannelTypeSchema>

export const notifyHealthStatusSchema = z.enum(['healthy', 'failing'])
export type NotifyHealthStatus = z.infer<typeof notifyHealthStatusSchema>

/** 渠道配置键：不同类型使用不同键，脱敏后以 configured 布尔返回 */
export const notifyConfigKeySchema = z.enum(['webhookUrl', 'secret', 'sendKey', 'token'])
export type NotifyConfigKey = z.infer<typeof notifyConfigKeySchema>

export const notifyChannelItemSchema = z.object({
  id: z.string(),
  type: notifyChannelTypeSchema,
  name: z.string(),
  enabled: z.boolean(),
  healthStatus: notifyHealthStatusSchema,
  lastErrorAt: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  createdAt: z.string(),
  /** 脱敏视图：仅暴露哪些配置键已填写 */
  configPreview: z.array(z.object({
    key: notifyConfigKeySchema,
    configured: z.boolean(),
  })),
})
export type NotifyChannelItem = z.infer<typeof notifyChannelItemSchema>

export const notifyChannelCreateRequestSchema = z.object({
  type: notifyChannelTypeSchema,
  name: z.string().trim().min(1).max(64),
  config: z.object({
    webhookUrl: z.string().trim().max(1024).optional(),
    secret: z.string().trim().max(256).optional(),
    sendKey: z.string().trim().max(256).optional(),
    token: z.string().trim().max(256).optional(),
  }).default({}),
})
export type NotifyChannelCreateRequest = z.infer<typeof notifyChannelCreateRequestSchema>

export const notifyChannelUpdateRequestSchema = z.object({
  channelId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  /** 空字符串表示清除该键；未提供表示保留原值 */
  config: z.object({
    webhookUrl: z.string().trim().max(1024).optional(),
    secret: z.string().trim().max(256).optional(),
    sendKey: z.string().trim().max(256).optional(),
    token: z.string().trim().max(256).optional(),
  }).optional(),
})
export type NotifyChannelUpdateRequest = z.infer<typeof notifyChannelUpdateRequestSchema>

export const notifyChannelIdRequestSchema = z.object({
  channelId: z.string().trim().min(1).max(128),
})
export type NotifyChannelIdRequest = z.infer<typeof notifyChannelIdRequestSchema>

export const notifyMutationResultSchema = z.object({
  isSuccess: z.boolean(),
  channelId: z.string().optional(),
})
export type NotifyMutationResult = z.infer<typeof notifyMutationResultSchema>

export const notifyTestResultSchema = z.object({
  isSuccess: z.boolean(),
  message: z.string().optional(),
})
export type NotifyTestResult = z.infer<typeof notifyTestResultSchema>

export const notifyThresholdsSchema = z.object({
  cpuPercent: z.number().min(1).max(100),
  memPercent: z.number().min(1).max(100),
  diskPercent: z.number().min(1).max(100),
})
export type NotifyThresholds = z.infer<typeof notifyThresholdsSchema>

export const notifySettingsSchema = z.object({
  enabled: z.boolean(),
  cooldownMinutes: z.number().int().min(1).max(1440),
  thresholds: notifyThresholdsSchema,
})
export type NotifySettings = z.infer<typeof notifySettingsSchema>

export const notifySettingsSaveRequestSchema = notifySettingsSchema
export type NotifySettingsSaveRequest = z.infer<typeof notifySettingsSaveRequestSchema>
