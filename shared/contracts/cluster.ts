import { z } from 'zod'
import { instanceIdSchema, instanceStatusSchema } from './instance'

export const clusterNetworkModeSchema = z.enum(['offline', 'lan_only', 'public'])
export type ClusterNetworkMode = z.infer<typeof clusterNetworkModeSchema>

export const clusterGameModeSchema = z.enum([
  'survival',
  'endless',
  'wilderness',
  'easy',
  'darkandwildernes',
])
export type ClusterGameMode = z.infer<typeof clusterGameModeSchema>

export const clusterIntentionSchema = z.enum([
  'cooperative',
  'competitive',
  'social',
  'madness',
])
export type ClusterIntention = z.infer<typeof clusterIntentionSchema>

export type ClusterInstanceStatus = z.infer<typeof instanceStatusSchema>

const clusterTextSchema = z.string().trim().max(2048)
const clusterPortSchema = z.number().int().min(1).max(65535)

export const clusterInstanceQuerySchema = z.object({
  instanceId: instanceIdSchema,
})

export const clusterConfigSchema = z.object({
  instanceId: instanceIdSchema,
  instanceName: z.string(),
  instanceStatus: instanceStatusSchema,
  networkMode: clusterNetworkModeSchema,
  clusterName: z.string(),
  clusterDescription: z.string(),
  clusterPassword: z.string(),
  gameMode: clusterGameModeSchema,
  maxPlayers: z.number().int().min(1).max(64),
  pvp: z.boolean(),
  pauseWhenEmpty: z.boolean(),
  voteEnabled: z.boolean(),
  clusterIntention: clusterIntentionSchema,
  tickRate: z.number().int().min(15).max(60),
  maxSnapshots: z.number().int().min(1),
  shardEnabled: z.boolean(),
  bindIp: z.string(),
  masterIp: z.string(),
  masterPort: clusterPortSchema,
  clusterKey: z.string(),
  steamGroupOnly: z.boolean(),
  steamGroupId: z.string(),
  steamGroupAdmins: z.boolean(),
  clusterTokenConfigured: z.boolean(),
  clusterTokenMasked: z.string().nullable(),
  panelRoomSaved: z.boolean(),
  configDirty: z.boolean(),
  /**
   * @deprecated 服务端不再产生提示文案，恒为空数组：面向用户的说明已内联到页面对应位置。
   * 字段暂时保留，仅为兼容仍执行缓存中旧前端的浏览器（旧代码做 `[...effectiveHints]`，缺字段会崩），下个版本移除。
   */
  effectiveHints: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type ClusterConfigDto = z.infer<typeof clusterConfigSchema>

export const clusterSavePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  networkMode: clusterNetworkModeSchema,
  clusterName: clusterTextSchema.min(1).max(128),
  clusterDescription: clusterTextSchema,
  clusterPassword: clusterTextSchema.max(256),
  gameMode: clusterGameModeSchema,
  maxPlayers: z.number().int().min(1).max(64),
  pvp: z.boolean(),
  pauseWhenEmpty: z.boolean(),
  voteEnabled: z.boolean(),
  clusterIntention: clusterIntentionSchema,
  tickRate: z.number().int().min(15).max(60),
  maxSnapshots: z.number().int().min(1).max(10_000),
  shardEnabled: z.boolean(),
  bindIp: clusterTextSchema.max(128),
  masterIp: clusterTextSchema.max(128),
  masterPort: clusterPortSchema,
  clusterKey: clusterTextSchema.max(256),
  steamGroupOnly: z.boolean(),
  steamGroupId: z.string().trim().regex(/^\d+$/).max(64),
  steamGroupAdmins: z.boolean(),
  clusterToken: z.string().trim().max(512).nullable().optional(),
  restart: z.boolean().optional(),
})
export type ClusterSavePayload = z.infer<typeof clusterSavePayloadSchema>

export const clusterSaveResultSchema = z.object({
  saved: z.literal(true),
  restarted: z.boolean(),
})
export type ClusterSaveResult = z.infer<typeof clusterSaveResultSchema>

export const clusterOnlinePlayersSchema = z.object({
  instanceId: instanceIdSchema,
  running: z.boolean(),
  onlinePlayerCount: z.number().int().nonnegative().nullable(),
  maxPlayers: z.number().int().min(1).max(64),
})
export type ClusterOnlinePlayersDto = z.infer<typeof clusterOnlinePlayersSchema>
