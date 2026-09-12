import { z } from 'zod'
import { instanceIdSchema, instanceStatusSchema } from './instance'

export const shardIdSchema = z.enum(['master', 'caves'])
export type ShardId = z.infer<typeof shardIdSchema>

export const shardContainerStatusSchema = z.enum([
  'running',
  'stopped',
  'not_created',
  'unknown',
])
export type ShardContainerStatus = z.infer<typeof shardContainerStatusSchema>

export const masterWorldgenPresetSchema = z.literal('SURVIVAL_TOGETHER')
export type MasterWorldgenPreset = z.infer<typeof masterWorldgenPresetSchema>

export const cavesWorldgenPresetSchema = z.enum([
  'DST_CAVE',
  'DST_CAVE_PLUS',
  'COMPLETE_DARKNESS',
])
export type CavesWorldgenPreset = z.infer<typeof cavesWorldgenPresetSchema>

export const shardWorldgenPresetSchema = z.union([
  masterWorldgenPresetSchema,
  cavesWorldgenPresetSchema,
])
export type ShardWorldgenPreset = z.infer<typeof shardWorldgenPresetSchema>

export type ShardInstanceStatus = z.infer<typeof instanceStatusSchema>

const portSchema = z.number().int().min(1).max(65535)
const overrideKeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64)
// 允许空格：DST 官方档位值存在 'highly random'（prefabswaps_start），写入 Lua 时带引号安全
/** 世界规则档位值的公共校验（允许空格：DST 官方值存在 'highly random'） */
export const overrideValueSchema = z.string().regex(/^[a-zA-Z0-9_.+ -]+$/).max(64)
const worldOverridesSchema = z.record(overrideKeySchema, overrideValueSchema).refine(
  value => Object.keys(value).length <= 128,
  '世界规则项不能超过 128 条',
)

export const shardInstanceQuerySchema = z.object({
  instanceId: instanceIdSchema,
})

export const shardSummarySchema = z.object({
  id: shardIdSchema,
  displayName: z.string(),
  configured: z.boolean(),
  containerStatus: shardContainerStatusSchema,
  serverPort: portSchema.nullable(),
  steamAuthPort: portSchema.nullable(),
  steamMasterPort: portSchema.nullable(),
  worldgenPreset: shardWorldgenPresetSchema.nullable(),
  /** 本分片已保存的世界配置覆盖项（真源：worldgenoverride.lua 的 overrides） */
  overrides: z.record(z.string(), z.string()).nullable(),
  worldGenerated: z.boolean(),
  isMaster: z.boolean(),
  panelSaved: z.boolean(),
  configDirty: z.boolean(),
})
export type ShardSummaryDto = z.infer<typeof shardSummarySchema>

export const shardListSchema = z.object({
  instanceId: instanceIdSchema,
  instanceName: z.string(),
  instanceStatus: instanceStatusSchema,
  clusterShardEnabled: z.boolean(),
  shards: z.array(shardSummarySchema),
  /**
   * @deprecated 服务端不再产生提示文案，恒为空数组：面向用户的说明已内联到页面对应位置。
   * 字段暂时保留，仅为兼容仍执行缓存中旧前端的浏览器（旧代码做 `[...effectiveHints]`，缺字段会崩），下个版本移除。
   */
  effectiveHints: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type ShardListDto = z.infer<typeof shardListSchema>

export const shardSavePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
  serverPort: portSchema,
  steamAuthPort: portSchema,
  steamMasterPort: portSchema,
  worldgenPreset: shardWorldgenPresetSchema,
  worldRuleOverrides: worldOverridesSchema.optional(),
  worldgenOverrides: worldOverridesSchema.optional(),
  restart: z.boolean().optional(),
}).superRefine((payload, context) => {
  const isValidMasterPreset = payload.shard === 'master'
    && payload.worldgenPreset === 'SURVIVAL_TOGETHER'
  const isValidCavesPreset = payload.shard === 'caves'
    && payload.worldgenPreset !== 'SURVIVAL_TOGETHER'
  if (!isValidMasterPreset && !isValidCavesPreset) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['worldgenPreset'],
      message: '世界生成预设与分片类型不匹配',
    })
  }
})
export type ShardSavePayload = z.infer<typeof shardSavePayloadSchema>

export const shardSaveResultSchema = z.object({
  saved: z.literal(true),
  restarted: z.boolean(),
})
export type ShardSaveResult = z.infer<typeof shardSaveResultSchema>

export const shardInitCavesResultSchema = z.object({
  initialized: z.boolean(),
  alreadyConfigured: z.boolean(),
  serverPort: portSchema,
  steamAuthPort: portSchema,
  steamMasterPort: portSchema,
  worldgenPreset: cavesWorldgenPresetSchema,
})
export type ShardInitCavesResult = z.infer<typeof shardInitCavesResultSchema>
