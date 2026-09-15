import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbPlayerProfile, UpsertPlayerProfileInput } from './types'
import { ensureDb, nowIso } from './connection'
import { instancePlayerProfiles } from './schema/index'

/** 一次查询最多返回多少条档案，避免前端下拉框被整表撑爆 */
export const PLAYER_PROFILE_QUERY_LIMIT = 50

const PROFILE_COLUMNS = {
  instanceId: instancePlayerProfiles.instanceId,
  kuId: instancePlayerProfiles.kuId,
  name: instancePlayerProfiles.name,
  note: instancePlayerProfiles.note,
  firstSeenAt: instancePlayerProfiles.firstSeenAt,
  lastSeenAt: instancePlayerProfiles.lastSeenAt,
  updatedAt: instancePlayerProfiles.updatedAt,
}

/**
 * 批量写入观测到的玩家名（在线查询、日志补档共用）。
 *
 * 写入规则：
 * - 已存在的档案只更新名字与最后出现时间，**不清空已有名字**：在线查询偶尔会拿到
 *   空名字（玩家实体 name 字段还没就绪），直接覆盖会把好不容易攒下的名字弄丢；
 * - 返回真正写入/更新的条数，界面据此说明「补到几个玩家」。
 */
export async function upsertPlayerProfiles(
  instanceId: string,
  profiles: UpsertPlayerProfileInput[],
): Promise<number> {
  const rows = profiles
    .map(profile => ({
      kuId: profile.kuId.trim(),
      name: (profile.name ?? '').trim(),
      seenAt: profile.seenAt ?? nowIso(),
    }))
    .filter(profile => profile.kuId.length > 0)
  if (rows.length === 0) {
    return 0
  }

  const { drizzleDb } = ensureDb()
  const now = nowIso()
  let affected = 0
  for (const row of rows) {
    const inserted = await drizzleDb
      .insert(instancePlayerProfiles)
      .values({
        instanceId,
        kuId: row.kuId,
        name: row.name,
        note: '',
        firstSeenAt: row.seenAt,
        lastSeenAt: row.seenAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [instancePlayerProfiles.instanceId, instancePlayerProfiles.kuId],
        set: {
          ...(row.name ? { name: row.name } : {}),
          lastSeenAt: row.seenAt,
          updatedAt: now,
        },
      })
      .returning({ kuId: instancePlayerProfiles.kuId })
    affected += inserted.length
  }
  return affected
}

/**
 * 列出档案。
 *
 * 关键词用 instr(lower(...)) 而不是 LIKE：玩家名里出现 % 或 _ 时，
 * LIKE 会把它当通配符，搜「100%」这类名字会莫名其妙匹配到一堆人。
 */
export async function listPlayerProfiles(
  instanceId: string,
  options?: { keyword?: string, limit?: number },
): Promise<DbPlayerProfile[]> {
  const { drizzleDb } = ensureDb()
  const keyword = (options?.keyword ?? '').trim()
  const limit = Math.min(Math.max(options?.limit ?? PLAYER_PROFILE_QUERY_LIMIT, 1), 500)
  const conditions = [eq(instancePlayerProfiles.instanceId, instanceId)]
  if (keyword) {
    conditions.push(
      sql`(instr(lower(${instancePlayerProfiles.name}), lower(${keyword})) > 0 or instr(lower(${instancePlayerProfiles.kuId}), lower(${keyword})) > 0)`,
    )
  }
  const rows = await drizzleDb
    .select(PROFILE_COLUMNS)
    .from(instancePlayerProfiles)
    .where(and(...conditions))
    .orderBy(desc(instancePlayerProfiles.lastSeenAt))
    .limit(limit)
  return rows
}

/** 按 ID 批量取档案（名单展示名字用），大小写不敏感 */
export async function findPlayerProfilesByKuIds(
  instanceId: string,
  kuIds: string[],
): Promise<Map<string, DbPlayerProfile>> {
  const result = new Map<string, DbPlayerProfile>()
  const normalized = [...new Set(kuIds.map(kuId => kuId.trim().toLowerCase()).filter(Boolean))]
  if (normalized.length === 0) {
    return result
  }
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select(PROFILE_COLUMNS)
    .from(instancePlayerProfiles)
    .where(and(
      eq(instancePlayerProfiles.instanceId, instanceId),
      inArray(sql`lower(${instancePlayerProfiles.kuId})`, normalized),
    ))
  for (const row of rows) {
    result.set(row.kuId.toLowerCase(), row)
  }
  return result
}

/** 设置或清除手工备注（备注只存在面板里，不写进游戏的名单文件） */
export async function setPlayerProfileNote(
  instanceId: string,
  kuId: string,
  note: string,
): Promise<DbPlayerProfile | undefined> {
  const { drizzleDb } = ensureDb()
  const trimmed = note.trim()
  const now = nowIso()
  const existing = await findPlayerProfilesByKuIds(instanceId, [kuId])
  const profile = existing.get(kuId.trim().toLowerCase())
  if (!profile) {
    // 还没有档案时也允许直接写备注：管理员可能先给一个只见过 ID 的人起个名字
    await upsertPlayerProfiles(instanceId, [{ kuId }])
  }
  await drizzleDb
    .update(instancePlayerProfiles)
    .set({ note: trimmed, updatedAt: now })
    .where(and(
      eq(instancePlayerProfiles.instanceId, instanceId),
      eq(instancePlayerProfiles.kuId, profile?.kuId ?? kuId.trim()),
    ))
  const updated = await findPlayerProfilesByKuIds(instanceId, [kuId])
  return updated.get(kuId.trim().toLowerCase())
}

/** 实例被删除时清掉它的档案，避免面板里留下再也用不到的玩家名 */
export async function removePlayerProfilesByInstance(instanceId: string): Promise<number> {
  const { drizzleDb } = ensureDb()
  const removed = await drizzleDb
    .delete(instancePlayerProfiles)
    .where(eq(instancePlayerProfiles.instanceId, instanceId))
    .returning({ kuId: instancePlayerProfiles.kuId })
  return removed.length
}
