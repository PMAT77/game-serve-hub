import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 面板侧的玩家档案：把 Klei 用户 ID 与游戏内名字对上号。
 *
 * 为什么需要：游戏的名单文件（adminlist / whitelist / blocklist）只认 KU_ 开头的
 * 用户 ID，管理员在界面上看到的却应该是一个个名字。面板自己记住「谁是谁」，
 * 名单才能按名字显示与搜索，也才谈得上「加了知道加的是谁」。
 *
 * 名字有三个来源，按可靠性排序：在线玩家查询（最准）、游戏日志里的历史记录、
 * 管理员手工备注（note）。
 */
export const instancePlayerProfiles = sqliteTable('instance_player_profiles', {
  instanceId: text('instance_id').notNull(),
  kuId: text('ku_id').notNull(),
  /** 游戏内名字；可能为空（只在日志里出现过 ID 时） */
  name: text('name').notNull().default(''),
  /** 管理员手工备注：名字都认不出来时的兜底 */
  note: text('note').notNull().default(''),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.instanceId, table.kuId] }),
])
