import { z } from 'zod'
import { instanceIdSchema } from './instance'

/** DST 玩家名单文件：管理员、封禁、白名单 */
export const playerListKindSchema = z.enum(['admin', 'block', 'whitelist'])
export type PlayerListKind = z.infer<typeof playerListKindSchema>

/** Klei 用户 ID，形如 KU_xxxxx；大小写按原样保留，去重与比对时忽略大小写 */
export const playerKuIdSchema = z.string().trim().regex(/^KU_[A-Za-z0-9_]{1,64}$/)
export type PlayerKuId = z.infer<typeof playerKuIdSchema>

export const playerListEntrySchema = z.object({
  kuId: playerKuIdSchema,
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
