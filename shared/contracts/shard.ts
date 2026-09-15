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

/** 回档步数上限：防御性上限，实际可用步数由游戏内快照与房间设置决定 */
export const SHARD_ROLLBACK_STEPS_LIMIT = 99

export const shardSnapshotSchema = z.object({
  /** 存档点目录名（游戏生成的会话 ID），只用于界面区分 */
  id: z.string(),
  /** 存档点的最后修改时间（ISO）；读不到时为空串 */
  savedAt: z.string(),
})
export type ShardSnapshotDto = z.infer<typeof shardSnapshotSchema>

export const shardSnapshotsQuerySchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
})
export type ShardSnapshotsQuery = z.infer<typeof shardSnapshotsQuerySchema>

export const shardSnapshotsSchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
  running: z.boolean(),
  /** 房间设置里的快照保留数量，决定回档可用的步数上限 */
  maxSnapshots: z.number().int().min(1),
  snapshots: z.array(shardSnapshotSchema),
  warnings: z.array(z.string()),
})
export type ShardSnapshotsDto = z.infer<typeof shardSnapshotsSchema>

export const shardRollbackPayloadSchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
  steps: z.number().int().min(1).max(SHARD_ROLLBACK_STEPS_LIMIT),
  /** 默认开启：回档前先自动备份一次，回档过头还能从备份翻回来 */
  backupBeforeRollback: z.boolean().optional(),
})
export type ShardRollbackPayload = z.infer<typeof shardRollbackPayloadSchema>

export const shardResetWorldPayloadSchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
  /** 二次确认：须与实例名完全一致，避免误点 */
  confirmName: z.string().trim().min(1).max(128),
})
export type ShardResetWorldPayload = z.infer<typeof shardResetWorldPayloadSchema>

export const shardMaintenanceResultSchema = z.object({
  accepted: z.literal(true),
  /** 实际下发的控制台命令，便于排错与展示 */
  command: z.string(),
  /** 安全备份 ID；未做备份或备份失败时为 null */
  backupId: z.string().nullable(),
  /** 备份失败的说明：备份失败不阻断操作，但必须如实告知 */
  backupWarning: z.string().nullable(),
})
export type ShardMaintenanceResult = z.infer<typeof shardMaintenanceResultSchema>
