import { z } from 'zod'
import { instanceIdSchema, instanceStatusSchema } from './instance'
import { playerOnlineIdSchema } from './player'

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
  /** 白名单预留位；0 表示白名单未启用 */
  whitelistSlots: z.number().int().min(0).max(64),
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
  /**
   * 可选：省略时保留磁盘上的现值。
   * 老版本前端不带该字段，按缺省 0 覆盖会把已启用的白名单悄然关掉。
   */
  whitelistSlots: z.number().int().min(0).max(64).optional(),
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

/**
 * 在线玩家一条记录。
 *
 * `kuId` 是游戏给出的原始 ID：Klei 账号形如 `KU_xxxxx`（踢人与封禁以它为凭据，
 * 比对时忽略大小写），离线或局域网进来的玩家拿到的是游戏临时分配的 ID，
 * 形状不受面板控制，甚至可能为空 —— 这类玩家只用于展示与踢出。
 * `name` 取自游戏实体的 name 字段，可能为空字符串，界面需容忍。
 */
export const clusterOnlinePlayerSchema = z.object({
  kuId: playerOnlineIdSchema,
  name: z.string(),
  /** 是否 Klei 账号：只有为 true 时这个 ID 才稳定到能写进名单或用于封禁 */
  kleiAccount: z.boolean(),
  /** 本次查询内唯一，供列表 key 与操作定位；ID 为空的条目由解析器分配序号 */
  key: z.string().min(1),
})
export type ClusterOnlinePlayer = z.infer<typeof clusterOnlinePlayerSchema>

export const clusterOnlinePlayersSchema = z.object({
  instanceId: instanceIdSchema,
  running: z.boolean(),
  onlinePlayerCount: z.number().int().nonnegative().nullable(),
  /**
   * 在线玩家明细。
   *
   * null 表示这次没取到（查询超时、标记行被日志挤掉等），与空数组含义不同：
   * 空数组是「确实没人在线」，null 是「不知道」，界面不能用同一种文案。
   */
  players: z.array(clusterOnlinePlayerSchema).nullable(),
  /**
   * 有人却列不出来的数量（onlinePlayerCount 多于明细条数）。
   *
   * 游戏没给出可用 ID 时人数照算、明细为空：界面必须说明，
   * 否则会出现「概览说 1 人在线、明细说没人」这种自相矛盾的画面。
   */
  unlistedPlayerCount: z.number().int().nonnegative(),
  /**
   * 是否有运行中的分片没答上来。
   *
   * 地上与洞穴是两个独立进程，只查到一侧时名单会少人；界面据此提示，
   * 而不是把「只查到一半」当成完整名单。
   */
  partial: z.boolean(),
  maxPlayers: z.number().int().min(1).max(64),
})
export type ClusterOnlinePlayersDto = z.infer<typeof clusterOnlinePlayersSchema>
