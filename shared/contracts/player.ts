import { z } from 'zod'
import { instanceIdSchema } from './instance'

/** DST 玩家名单文件：管理员、封禁、白名单 */
export const playerListKindSchema = z.enum(['admin', 'block', 'whitelist'])
export type PlayerListKind = z.infer<typeof playerListKindSchema>

/** Klei 用户 ID，形如 KU_xxxxx；大小写按原样保留，去重与比对时忽略大小写 */
export const playerKuIdSchema = z.string().trim().regex(/^KU_[A-Za-z0-9_]{1,64}$/)
export type PlayerKuId = z.infer<typeof playerKuIdSchema>

/** DST 的地上 / 洞穴分片 */
export const playerShardSchema = z.enum(['master', 'caves'])
export type PlayerShard = z.infer<typeof playerShardSchema>

/**
 * 名单条目。
 *
 * `kuId` 是唯一会被写进游戏名单文件的内容；`name`、`note` 只是面板侧的展示信息，
 * 来自玩家档案（见 server/src/shared/db/schema/player.ts），旧前端忽略这两个字段即可。
 */
export const playerListEntrySchema = z.object({
  kuId: playerKuIdSchema,
  /** 面板档案里记录的游戏名；还没有档案时为空字符串 */
  name: z.string().optional(),
  /** 管理员手工备注 */
  note: z.string().optional(),
})
export type PlayerListEntry = z.infer<typeof playerListEntrySchema>

export const playerListQuerySchema = z.object({
  instanceId: instanceIdSchema,
  kind: playerListKindSchema,
})
export type PlayerListQuery = z.infer<typeof playerListQuerySchema>

export const playerListSchema = z.object({
  instanceId: instanceIdSchema,
  kind: playerListKindSchema,
  entries: z.array(playerListEntrySchema),
  /** 名单文件是否存在；不存在表示从未写入过条目 */
  fileExists: z.boolean(),
  /** cluster.ini 的 whitelist_slots：0 表示白名单未生效，界面据此给出开关与说明 */
  whitelistSlots: z.number().int().min(0),
  warnings: z.array(z.string()),
})
export type PlayerListDto = z.infer<typeof playerListSchema>

export const playerListSavePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  kind: playerListKindSchema,
  entries: z.array(playerListEntrySchema).max(500),
})
export type PlayerListSavePayload = z.infer<typeof playerListSavePayloadSchema>

export const playerListSaveResultSchema = z.object({
  saved: z.literal(true),
  entries: z.array(playerListEntrySchema),
})
export type PlayerListSaveResult = z.infer<typeof playerListSaveResultSchema>

/** 一个在线玩家，含他当前所在的世界（地上 / 洞穴） */
export const playerOnlineEntrySchema = z.object({
  kuId: playerKuIdSchema,
  name: z.string(),
  shard: playerShardSchema,
})
export type PlayerOnlineEntry = z.infer<typeof playerOnlineEntrySchema>

const playerShardSnapshotSchema = z.object({
  /** 该分片是否在运行；未运行时不查询，players 为 null */
  running: z.boolean(),
  /** 该分片是否已配置（洞穴未开启时恒为 false） */
  configured: z.boolean(),
  /** null 表示这次没取到（查询超时、日志被挤掉），与空数组含义不同 */
  players: z.array(playerOnlineEntrySchema).nullable(),
})

/**
 * 在线玩家总览。
 *
 * 地上与洞穴是两个独立进程、玩家列表互不可见，所以按分片给出明细，
 * 再用 players 汇总一份便于展示；partial 为 true 时说明至少有一个运行中的分片
 * 没查到，界面必须提示「名单可能不全」，不能当成「就这些人在线」。
 */
export const playerOnlineRosterSchema = z.object({
  instanceId: instanceIdSchema,
  running: z.boolean(),
  maxPlayers: z.number().int().min(1).max(64),
  onlinePlayerCount: z.number().int().nonnegative().nullable(),
  shards: z.object({
    master: playerShardSnapshotSchema,
    caves: playerShardSnapshotSchema,
  }),
  players: z.array(playerOnlineEntrySchema),
  partial: z.boolean(),
})
export type PlayerOnlineRosterDto = z.infer<typeof playerOnlineRosterSchema>

/** 玩家档案：面板侧记下的「ID ↔ 游戏名」 */
export const playerProfileSchema = z.object({
  kuId: playerKuIdSchema,
  name: z.string(),
  note: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})
export type PlayerProfileDto = z.infer<typeof playerProfileSchema>

export const playerProfileQuerySchema = z.object({
  instanceId: instanceIdSchema,
  keyword: z.string().trim().max(64).optional(),
})
export type PlayerProfileQuery = z.infer<typeof playerProfileQuerySchema>

export const playerProfileSearchResultSchema = z.object({
  instanceId: instanceIdSchema,
  keyword: z.string(),
  items: z.array(playerProfileSchema),
})
export type PlayerProfileSearchResult = z.infer<typeof playerProfileSearchResultSchema>

export const playerProfileNotePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  kuId: playerKuIdSchema,
  /** 备注名；空字符串表示清除 */
  note: z.string().trim().max(64),
})
export type PlayerProfileNotePayload = z.infer<typeof playerProfileNotePayloadSchema>

/** 从游戏日志补档的结果：解析到多少条线索、实际写入多少条档案 */
export const playerProfileSyncResultSchema = z.object({
  hints: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
})
export type PlayerProfileSyncResult = z.infer<typeof playerProfileSyncResultSchema>

/**
 * 踢出 / 封禁的目标玩家。
 *
 * 只按 Klei 用户 ID 指定，不接受玩家名：名字可重复、可在游戏内改名，
 * 按名字操作存在误伤别人的可能。名字只用于界面选择，选择后仍然落到 ID。
 */
export const playerActionPayloadSchema = z.object({
  instanceId: instanceIdSchema,
  kuId: playerKuIdSchema,
  /** 目标玩家所在的分片；省略时由服务端在两个分片里探测 */
  shard: playerShardSchema.optional(),
})
export type PlayerActionPayload = z.infer<typeof playerActionPayloadSchema>

export const playerKickResultSchema = z.object({
  isSuccess: z.literal(true),
  /** 命令已下发 */
  verified: z.boolean(),
  /**
   * 面向用户的一句话。
   *
   * verified 为 true 才代表「复查在线名单确认该玩家已离开」；查不到结果时如实说
   * 「没能确认」，不再无条件宣称成功。句子里的「该玩家」由界面替换成实际昵称，
   * 说明性的技术细节一律留在面板日志里，不写进这句话。
   */
  message: z.string(),
})
export type PlayerKickResult = z.infer<typeof playerKickResultSchema>

export const playerBanResultSchema = z.object({
  isSuccess: z.literal(true),
  /** 命令已下发并确认玩家已离开房间 */
  verified: z.boolean(),
  message: z.string(),
  /** 落盘后的黑名单全量条目，界面据此刷新名单，不必再发一次请求 */
  entries: z.array(playerListEntrySchema),
})
export type PlayerBanResult = z.infer<typeof playerBanResultSchema>
