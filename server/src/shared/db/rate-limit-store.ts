import { ensureDb } from './connection'

export interface RateLimitState {
  failedCount: number
  windowStart: number
  blockedUntil: number
}

const PRUNE_CHECK_INTERVAL_MS = 5 * 60 * 1000
/** window_start 超过该时长的行视为过期，可安全清理 */
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000
let lastPrunedAt = 0

interface RateLimitRow {
  failed_count: number
  window_start: number
  blocked_until: number
}

/** 读取限流状态；不存在的 key 返回 undefined */
export function getRateLimitState(key: string): RateLimitState | undefined {
  const { sqliteDb } = ensureDb()
  const row = sqliteDb
    .prepare('SELECT failed_count, window_start, blocked_until FROM auth_rate_limits WHERE key = ?')
    .get(key) as RateLimitRow | undefined
  if (!row) {
    return undefined
  }
  return {
    failedCount: row.failed_count,
    windowStart: row.window_start,
    blockedUntil: row.blocked_until,
  }
}

/** 写入限流状态（upsert）；顺带低频清理过期行，保证表容量有界 */
export function saveRateLimitState(key: string, state: RateLimitState): void {
  const { sqliteDb } = ensureDb()
  sqliteDb.prepare(`
    INSERT INTO auth_rate_limits (key, failed_count, window_start, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      failed_count = excluded.failed_count,
      window_start = excluded.window_start,
      blocked_until = excluded.blocked_until,
      updated_at = excluded.updated_at
  `).run(key, state.failedCount, state.windowStart, state.blockedUntil, Date.now())
  maybePrune()
}

export function deleteRateLimitState(key: string): void {
  const { sqliteDb } = ensureDb()
  sqliteDb.prepare('DELETE FROM auth_rate_limits WHERE key = ?').run(key)
}

function maybePrune(): void {
  const now = Date.now()
  if (now - lastPrunedAt < PRUNE_CHECK_INTERVAL_MS) {
    return
  }
  lastPrunedAt = now
  try {
    const { sqliteDb } = ensureDb()
    sqliteDb.prepare('DELETE FROM auth_rate_limits WHERE window_start < ?').run(now - PRUNE_AGE_MS)
  }
  catch {
    // 清理失败不影响限流主流程
  }
}
