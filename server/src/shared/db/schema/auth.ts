import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  account: text('account').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  email: text('email').notNull().default(''),
  avatar: text('avatar').notNull().default(''),
  status: integer('status').notNull().default(1),
  mustChangePassword: integer('must_change_password').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const userPermissions = sqliteTable('user_permissions', {
  userId: text('user_id').notNull(),
  permission: text('permission').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.permission] }),
])

/** 认证限流状态（登录守卫、找回/改密失败计数）；重启不清零，由应用侧定期清理过期行 */
export const authRateLimits = sqliteTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  windowStart: integer('window_start').notNull(),
  blockedUntil: integer('blocked_until').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
})

export const authSessions = sqliteTable('auth_sessions', {
  token: text('token').primaryKey(),
  tokenHash: text('token_hash'),
  refreshTokenHash: text('refresh_token_hash'),
  userId: text('user_id').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at'),
  refreshExpiresAt: text('refresh_expires_at'),
  rotatedAt: text('rotated_at'),
  lastSeenIp: text('last_seen_ip'),
  userAgent: text('user_agent'),
  revokedAt: text('revoked_at'),
})
