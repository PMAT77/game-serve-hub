import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { SYSTEM_MANAGE_PERMISSION, SYSTEM_READ_PERMISSION } from '../menu-routes'
import {
  authSessions,
  gameInstances,
  instanceMaintenanceDrafts,
  instanceMaintenancePushLogs,
  serverNodes,
  systemSettings,
  userPermissions,
  users,
} from './schema/index'

interface DbUserRow {
  id: string
  account: string
  password_hash: string
  email: string
  avatar: string
  status: number
  must_change_password: number
  updated_at: string
}

interface InitDatabaseOptions {
  forcePasswordChange?: boolean
  adminUsername?: string
  adminPassword?: string
}

interface AuthForcePasswordChangeState {
  pending: boolean
  completed: boolean
}

const AUTH_FORCE_PASSWORD_CHANGE_KEY = 'auth.force_password_change'
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_TOKEN_REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ADMIN_DEFAULT_PERMISSIONS = [
  'pages.general:browse',
  'pages.form:browse',
  'pages.list:browse',
  'pages.shop:browse',
  'pages.node.instance:manage',
  SYSTEM_READ_PERMISSION,
  SYSTEM_MANAGE_PERMISSION,
]

interface DbDefaultUserSeed {
  account: string
  password: string
  email: string
  avatar: string
  permissions: string[]
}

export interface SessionTokenBundle {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt: string
  accessExpiresInSec: number
  refreshExpiresInSec: number
}

export interface DbSystemNetworkConfig {
  mode: 'bootstrap_pending' | 'managed'
  httpPort: number
  domain: string
  tls: {
    enabled: boolean
    provider: 'none' | 'letsencrypt' | 'custom'
  }
}

export interface DbSystemPanelSettings {
  panelPort: number
  theme: 'light' | 'dark' | 'system'
  autoUpdate: boolean
  /** 启动实例前是否向 Steam 拉取 Build ID 并拦截有更新的启动 */
  checkUpdateBeforeStart: boolean
  /** Hub 镜像自动检查间隔（小时） */
  updateCheckIntervalHours: number
}

export interface DbSystemSteamcmdConfig {
  steamcmdPath: string
  installRoot: string
}

export interface DbServerNode {
  id: string
  name: string
  host: string
  sshPort: number
  status: 'online' | 'offline'
  cpuUsage: number
  memoryUsage: number
  diskUsage: number
  lastHeartbeatAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SaveServerNodeInput {
  id: string
  name: string
  host: string
  sshPort?: number
  status?: 'online' | 'offline'
  cpuUsage?: number
  memoryUsage?: number
  diskUsage?: number
  lastHeartbeatAt?: string | null
}

export type DbGameInstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'
export type DbInstallLogStatus = 'running' | 'success' | 'failed'

export interface DbGameInstance {
  id: string
  nodeId: string
  name: string
  gameCode: string
  status: DbGameInstanceStatus
  containerId: string | null
  runtimePid: number | null
  runtimeStartedAt: string | null
  installPath: string | null
  configPath: string | null
  queryPort: number | null
  gamePort: number | null
  rconPort: number | null
  lastCommand: string | null
  lastExitCode: number | null
  lastError: string | null
  installLogStatus: DbInstallLogStatus | null
  installPercent: number | null
  installLogUpdatedAt: string | null
  updateAvailable: boolean
  localBuildId: string | null
  remoteBuildId: string | null
  updateCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateGameInstanceInput {
  id?: string
  nodeId: string
  name: string
  gameCode: string
  status?: DbGameInstanceStatus
  containerId?: string | null
  runtimePid?: number | null
  installPath?: string | null
  configPath?: string | null
  queryPort?: number | null
  gamePort?: number | null
  rconPort?: number | null
  lastCommand?: string | null
  lastExitCode?: number | null
  lastError?: string | null
}

export interface UpdateGameInstanceRuntimeInput {
  status?: DbGameInstanceStatus
  containerId?: string | null
  runtimePid?: number | null
  runtimeStartedAt?: string | null
  gamePort?: number | null
  lastCommand?: string | null
  lastExitCode?: number | null
  lastError?: string | null
  installLogStatus?: DbInstallLogStatus | null
  installPercent?: number | null
  installLogUpdatedAt?: string | null
  updateAvailable?: boolean
  localBuildId?: string | null
  remoteBuildId?: string | null
  updateCheckedAt?: string | null
}

const defaultUserSeeds: DbDefaultUserSeed[] = [
  {
    account: 'superadmin',
    password: '123456',
    email: 'superadmin@game.com',
    avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=superadmin',
    permissions: [
      'pages.general:browse',
      'pages.form:browse',
      'pages.list:browse',
      'pages.shop:browse',
      'pages.node.instance:manage',
      SYSTEM_READ_PERMISSION,
      SYSTEM_MANAGE_PERMISSION,
    ],
  },
  {
    account: 'test',
    password: '123456',
    email: 'test@game.com',
    avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=test',
    permissions: ['pages.general:browse'],
  },
]

let sqliteDb: DatabaseSync | undefined
let drizzleDb: ReturnType<typeof drizzle> | undefined

function nowIso() {
  return new Date().toISOString()
}

function hashPassword(password: string, salt = randomUUID()) {
  const derivedKey = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derivedKey}`
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function generateSessionToken(prefix: 'atk' | 'rtk') {
  return `${prefix}_${randomBytes(32).toString('hex')}`
}

function toIsoFromMs(valueMs: number) {
  return new Date(valueMs).toISOString()
}

function isExpiredAt(iso: string | null | undefined, nowMs = Date.now()) {
  if (!iso) {
    return false
  }
  const expiresMs = Date.parse(iso)
  if (Number.isNaN(expiresMs)) {
    return false
  }
  return expiresMs <= nowMs
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, hashed] = storedHash.split(':')
  if (!salt || !hashed) {
    return false
  }
  const passwordBuffer = scryptSync(password, salt, 64)
  const hashBuffer = Buffer.from(hashed, 'hex')
  if (passwordBuffer.length !== hashBuffer.length) {
    return false
  }
  return timingSafeEqual(passwordBuffer, hashBuffer)
}

function ensureDb() {
  if (!sqliteDb || !drizzleDb) {
    throw new Error('SQLite database is not initialized')
  }
  return {
    sqliteDb,
    drizzleDb,
  }
}

function tableHasColumn(database: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === columnName)
}

function ensureColumn(database: DatabaseSync, tableName: string, columnName: string, columnDefinition: string) {
  if (tableHasColumn(database, tableName, columnName)) {
    return
  }
  database.exec(`ALTER TABLE ${tableName} ADD ${columnName} ${columnDefinition}`)
}

function ensureSchemaCompatibility(database: DatabaseSync) {
  const usersTableExists = database.prepare(`
    SELECT 1 AS ok
    FROM sqlite_master
    WHERE type = 'table' AND name = 'users'
    LIMIT 1
  `).get() as { ok: number } | undefined
  if (!usersTableExists) {
    return
  }

  ensureColumn(database, 'users', 'must_change_password', 'integer DEFAULT 0 NOT NULL')

  const authSessionsTableExists = database.prepare(`
    SELECT 1 AS ok
    FROM sqlite_master
    WHERE type = 'table' AND name = 'auth_sessions'
    LIMIT 1
  `).get() as { ok: number } | undefined
  if (authSessionsTableExists) {
    ensureColumn(database, 'auth_sessions', 'token_hash', 'text')
    ensureColumn(database, 'auth_sessions', 'refresh_token_hash', 'text')
    ensureColumn(database, 'auth_sessions', 'expires_at', 'text')
    ensureColumn(database, 'auth_sessions', 'refresh_expires_at', 'text')
    ensureColumn(database, 'auth_sessions', 'rotated_at', 'text')
    ensureColumn(database, 'auth_sessions', 'last_seen_ip', 'text')
    ensureColumn(database, 'auth_sessions', 'user_agent', 'text')
    database.exec('CREATE INDEX IF NOT EXISTS auth_sessions_token_hash_idx ON auth_sessions(token_hash)')
    database.exec('CREATE INDEX IF NOT EXISTS auth_sessions_refresh_token_hash_idx ON auth_sessions(refresh_token_hash)')
  }

  const gameInstancesTableExists = database.prepare(`
    SELECT 1 AS ok
    FROM sqlite_master
    WHERE type = 'table' AND name = 'game_instances'
    LIMIT 1
  `).get() as { ok: number } | undefined
  if (!gameInstancesTableExists) {
    return
  }

  ensureColumn(database, 'game_instances', 'runtime_pid', 'integer')
  ensureColumn(database, 'game_instances', 'runtime_started_at', 'text')
  ensureColumn(database, 'game_instances', 'last_command', 'text')
  ensureColumn(database, 'game_instances', 'last_exit_code', 'integer')
  ensureColumn(database, 'game_instances', 'last_error', 'text')
  // install_log_* 由 drizzle 0003 迁移维护，勿在此 ensureColumn，避免与未入账的 0003 SQL 重复 ADD
}

function isDuplicateColumnSqliteError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const withCode = error as Error & { code?: string, errcode?: number }
  if (withCode.code === 'ERR_SQLITE_ERROR' && withCode.errcode === 1) {
    return /duplicate column name/i.test(error.message)
  }
  return /duplicate column name/i.test(error.message)
}

function execMigrationQuery(database: DatabaseSync, query: string) {
  try {
    database.exec(query)
  }
  catch (error) {
    if (isDuplicateColumnSqliteError(error)) {
      return
    }
    throw error
  }
}

async function applyMigrations(migrationsFolder: string) {
  const { sqliteDb, drizzleDb } = ensureDb()
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `)
  bootstrapLegacyMigrationBaseline(sqliteDb, migrationsFolder)
  await migrate(
    drizzleDb,
    async (queries) => {
      for (const query of queries) {
        execMigrationQuery(sqliteDb, query)
      }
    },
    { migrationsFolder },
  )
  ensureSchemaCompatibility(sqliteDb)
  // 旧库若曾通过历史 ensureColumn 写入 install_log_* 但 0003 未入账，补列后仍保证三列存在
  ensureColumn(sqliteDb, 'game_instances', 'install_log_status', 'text')
  ensureColumn(sqliteDb, 'game_instances', 'install_percent', 'integer')
  ensureColumn(sqliteDb, 'game_instances', 'install_log_updated_at', 'text')
  ensureColumn(sqliteDb, 'game_instances', 'update_available', 'integer DEFAULT 0 NOT NULL')
  ensureColumn(sqliteDb, 'game_instances', 'local_build_id', 'text')
  ensureColumn(sqliteDb, 'game_instances', 'remote_build_id', 'text')
  ensureColumn(sqliteDb, 'game_instances', 'update_checked_at', 'text')
}

function bootstrapLegacyMigrationBaseline(database: DatabaseSync, migrationsFolder: string) {
  const migrationsTable = '__drizzle_migrations'
  const usersTableExists = database.prepare(`
    SELECT 1 AS ok
    FROM sqlite_master
    WHERE type = 'table' AND name = 'users'
    LIMIT 1
  `).get() as { ok: number } | undefined

  if (!usersTableExists) {
    return
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `)
  const migrationExists = database.prepare(`
    SELECT 1 AS ok
    FROM ${migrationsTable}
    LIMIT 1
  `).get() as { ok: number } | undefined

  if (migrationExists) {
    return
  }

  const migrations = readMigrationFiles({ migrationsFolder })
  const baselineMigration = migrations[0]
  if (!baselineMigration) {
    return
  }
  // 仅标记首条迁移为已应用，避免旧库跳过 0001/0002 等后续增量 SQL。
  database.prepare(`
    INSERT INTO ${migrationsTable} (hash, created_at)
    VALUES (?, ?)
  `).run(baselineMigration.hash, baselineMigration.folderMillis)
}

async function seedDefaultUsers() {
  const { drizzleDb } = ensureDb()
  const now = nowIso()

  for (const user of defaultUserSeeds) {
    const existing = await drizzleDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.account, user.account))
      .limit(1)
    const existingUser = existing[0]
    const userId = existingUser?.id ?? randomUUID()
    if (!existingUser) {
      await drizzleDb.insert(users).values({
        id: userId,
        account: user.account,
        passwordHash: hashPassword(user.password),
        email: user.email,
        avatar: user.avatar,
        status: 1,
        mustChangePassword: 0,
        createdAt: now,
        updatedAt: now,
      })
    }
    for (const permission of user.permissions) {
      await drizzleDb
        .insert(userPermissions)
        .values({
          userId,
          permission,
          createdAt: now,
        })
        .onConflictDoNothing()
    }
  }
}

function parseAuthForcePasswordChangeState(raw: string | undefined): AuthForcePasswordChangeState | undefined {
  if (!raw) {
    return undefined
  }
  try {
    const value = JSON.parse(raw) as Partial<AuthForcePasswordChangeState>
    if (typeof value.pending !== 'boolean' || typeof value.completed !== 'boolean') {
      return undefined
    }
    return {
      pending: value.pending,
      completed: value.completed,
    }
  }
  catch {
    return undefined
  }
}

async function getAuthForcePasswordChangeState(): Promise<AuthForcePasswordChangeState | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      value: systemSettings.value,
    })
    .from(systemSettings)
    .where(eq(systemSettings.key, AUTH_FORCE_PASSWORD_CHANGE_KEY))
    .limit(1)
  return parseAuthForcePasswordChangeState(rows[0]?.value)
}

async function saveAuthForcePasswordChangeState(state: AuthForcePasswordChangeState) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .insert(systemSettings)
    .values({
      key: AUTH_FORCE_PASSWORD_CHANGE_KEY,
      value: JSON.stringify(state),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: JSON.stringify(state),
        updatedAt: now,
      },
    })
}

async function setMustChangePasswordForAccount(account: string, mustChange: boolean) {
  const { drizzleDb } = ensureDb()
  await drizzleDb
    .update(users)
    .set({
      mustChangePassword: mustChange ? 1 : 0,
      updatedAt: nowIso(),
    })
    .where(eq(users.account, account))
}

async function seedAdminUserFromEnv(options: InitDatabaseOptions) {
  const adminUsername = options.adminUsername?.trim() ?? ''
  const adminPassword = options.adminPassword ?? ''
  if (!adminUsername || !adminPassword) {
    return
  }

  const { drizzleDb } = ensureDb()
  const now = nowIso()
  const existing = await drizzleDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.account, adminUsername))
    .limit(1)
  const userId = existing[0]?.id ?? randomUUID()
  const mustChangePassword = options.forcePasswordChange ? 1 : 0

  if (!existing[0]) {
    await drizzleDb.insert(users).values({
      id: userId,
      account: adminUsername,
      passwordHash: hashPassword(adminPassword),
      email: `${adminUsername}@local`,
      avatar: `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${adminUsername}`,
      status: 1,
      mustChangePassword,
      createdAt: now,
      updatedAt: now,
    })
  }
  else {
    await drizzleDb
      .update(users)
      .set({
        passwordHash: hashPassword(adminPassword),
        mustChangePassword,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
  }

  for (const permission of ADMIN_DEFAULT_PERMISSIONS) {
    await drizzleDb
      .insert(userPermissions)
      .values({
        userId,
        permission,
        createdAt: now,
      })
      .onConflictDoNothing()
  }
}

async function applyForcePasswordChangePolicy(options: InitDatabaseOptions) {
  if (!options.forcePasswordChange) {
    return
  }

  const adminAccount = options.adminUsername?.trim() || 'superadmin'
  const state = await getAuthForcePasswordChangeState()
  if (state?.completed) {
    return
  }

  await setMustChangePasswordForAccount(adminAccount, true)
  await saveAuthForcePasswordChangeState({
    pending: true,
    completed: false,
  })
}

export async function initDatabase(
  dbPath: string,
  migrationsFolder: string,
  options: InitDatabaseOptions = {},
) {
  const absolutePath = path.resolve(dbPath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  sqliteDb = new DatabaseSync(absolutePath)
  drizzleDb = drizzle(async (query, params, method) => {
    if (!sqliteDb) {
      throw new Error('SQLite database is not initialized')
    }
    const stmt = sqliteDb.prepare(query)

    switch (method) {
      case 'run':
        stmt.run(...params)
        return { rows: [] }
      case 'get': {
        stmt.setReturnArrays(true)
        const row = stmt.get(...params)
        return { rows: row ? row as unknown as unknown[] : [] }
      }
      case 'values':
        stmt.setReturnArrays(true)
        return { rows: stmt.all(...params) as unknown[] }
      case 'all':
      default:
        stmt.setReturnArrays(true)
        return { rows: stmt.all(...params) as unknown[] }
    }
  })
  await applyMigrations(path.resolve(migrationsFolder))
  await seedDefaultUsers()
  await seedAdminUserFromEnv(options)
  await applyForcePasswordChangePolicy(options)
  return absolutePath
}

export function userMustChangePassword(user: Pick<DbUserRow, 'must_change_password'>): boolean {
  return user.must_change_password === 1
}

/** 首次登录改密提示已展示：清除用户标记，并结束安装阶段的 FORCE_PASSWORD_CHANGE 待办 */
export async function consumeFirstLoginPasswordChangePrompt(userId: string) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .update(users)
    .set({
      mustChangePassword: 0,
      updatedAt: now,
    })
    .where(
      and(
        eq(users.id, userId),
        eq(users.mustChangePassword, 1),
      ),
    )

  const state = await getAuthForcePasswordChangeState()
  if (state?.pending) {
    await saveAuthForcePasswordChangeState({
      pending: false,
      completed: true,
    })
  }
}

export async function findUserByAccount(account: string): Promise<DbUserRow | undefined> {
  const { drizzleDb } = ensureDb()
  const result = await drizzleDb
    .select({
      id: users.id,
      account: users.account,
      password_hash: users.passwordHash,
      email: users.email,
      avatar: users.avatar,
      status: users.status,
      must_change_password: users.mustChangePassword,
      updated_at: users.updatedAt,
    })
    .from(users)
    .where(
      and(
        eq(users.account, account),
        eq(users.status, 1),
      ),
    )
    .limit(1)
  return result[0]
}

export async function createSession(token: string, userId: string) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb.insert(authSessions).values({
    token,
    tokenHash: null,
    refreshTokenHash: null,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: null,
    refreshExpiresAt: null,
    rotatedAt: null,
    lastSeenIp: null,
    userAgent: null,
    revokedAt: null,
  })
}

export async function createSessionTokens(
  userId: string,
  options: {
    remember?: boolean
    ip?: string
    userAgent?: string
  } = {},
): Promise<SessionTokenBundle> {
  const { drizzleDb } = ensureDb()
  const nowMs = Date.now()
  const now = toIsoFromMs(nowMs)
  const accessExpiresInMs = ACCESS_TOKEN_TTL_MS
  const refreshExpiresInMs = options.remember ? REFRESH_TOKEN_REMEMBER_TTL_MS : REFRESH_TOKEN_TTL_MS
  const accessExpiresAt = toIsoFromMs(nowMs + accessExpiresInMs)
  const refreshExpiresAt = toIsoFromMs(nowMs + refreshExpiresInMs)
  const accessToken = generateSessionToken('atk')
  const refreshToken = generateSessionToken('rtk')

  await drizzleDb.insert(authSessions).values({
    token: randomUUID(),
    tokenHash: hashSessionToken(accessToken),
    refreshTokenHash: hashSessionToken(refreshToken),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: accessExpiresAt,
    refreshExpiresAt,
    rotatedAt: null,
    lastSeenIp: options.ip ?? null,
    userAgent: options.userAgent ?? null,
    revokedAt: null,
  })

  return {
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    accessExpiresInSec: Math.floor(accessExpiresInMs / 1000),
    refreshExpiresInSec: Math.floor(refreshExpiresInMs / 1000),
  }
}

export async function revokeSession(token: string) {
  const { drizzleDb } = ensureDb()
  const tokenHash = hashSessionToken(token)
  await drizzleDb
    .update(authSessions)
    .set({
      revokedAt: nowIso(),
    })
    .where(
      and(
        or(
          eq(authSessions.token, token),
          eq(authSessions.tokenHash, tokenHash),
          eq(authSessions.refreshTokenHash, tokenHash),
        ),
        isNull(authSessions.revokedAt),
      ),
    )
}

export async function revokeSessionsByUserId(userId: string) {
  const { drizzleDb } = ensureDb()
  await drizzleDb
    .update(authSessions)
    .set({
      revokedAt: nowIso(),
    })
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
      ),
    )
}

export async function findUserByToken(token: string): Promise<DbUserRow | undefined> {
  const { drizzleDb } = ensureDb()
  const tokenHash = hashSessionToken(token)
  const now = nowIso()
  const result = await drizzleDb
    .select({
      sessionToken: authSessions.token,
      expiresAt: authSessions.expiresAt,
      id: users.id,
      account: users.account,
      password_hash: users.passwordHash,
      email: users.email,
      avatar: users.avatar,
      status: users.status,
      must_change_password: users.mustChangePassword,
      updated_at: users.updatedAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        or(
          eq(authSessions.tokenHash, tokenHash),
          eq(authSessions.token, token),
        ),
        isNull(authSessions.revokedAt),
        eq(users.status, 1),
      ),
    )
    .limit(1)
  const row = result[0]
  if (!row) {
    return undefined
  }
  if (isExpiredAt(row.expiresAt)) {
    // access token 过期后应允许客户端使用 refresh token 续期，
    // 这里不能直接撤销整条会话记录（否则会连带使 refresh token 失效）。
    return undefined
  }
  await drizzleDb
    .update(authSessions)
    .set({
      lastSeenAt: now,
    })
    .where(eq(authSessions.token, row.sessionToken))
  return {
    id: row.id,
    account: row.account,
    password_hash: row.password_hash,
    email: row.email,
    avatar: row.avatar,
    status: row.status,
    must_change_password: row.must_change_password,
    updated_at: row.updated_at,
  }
}

export async function rotateSessionByRefreshToken(
  refreshToken: string,
  options: {
    ip?: string
    userAgent?: string
  } = {},
): Promise<{ user: Pick<DbUserRow, 'id' | 'account' | 'email' | 'avatar'>, tokens: SessionTokenBundle } | undefined> {
  const { drizzleDb } = ensureDb()
  const nowMs = Date.now()
  const now = toIsoFromMs(nowMs)
  const refreshTokenHash = hashSessionToken(refreshToken)
  const row = (await drizzleDb
    .select({
      sessionToken: authSessions.token,
      refreshExpiresAt: authSessions.refreshExpiresAt,
      createdAt: authSessions.createdAt,
      userId: users.id,
      account: users.account,
      email: users.email,
      avatar: users.avatar,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.refreshTokenHash, refreshTokenHash),
        isNull(authSessions.revokedAt),
        eq(users.status, 1),
      ),
    )
    .limit(1))[0]

  if (!row) {
    return undefined
  }
  if (isExpiredAt(row.refreshExpiresAt, nowMs)) {
    await revokeSession(refreshToken)
    return undefined
  }

  await drizzleDb
    .update(authSessions)
    .set({
      revokedAt: now,
      rotatedAt: now,
    })
    .where(eq(authSessions.token, row.sessionToken))

  const createdAtMs = Date.parse(row.createdAt)
  const refreshExpiresAtMs = row.refreshExpiresAt ? Date.parse(row.refreshExpiresAt) : Number.NaN
  const remember = !Number.isNaN(createdAtMs)
    && !Number.isNaN(refreshExpiresAtMs)
    && refreshExpiresAtMs - createdAtMs > REFRESH_TOKEN_TTL_MS

  const tokens = await createSessionTokens(row.userId, {
    remember,
    ip: options.ip,
    userAgent: options.userAgent,
  })

  return {
    user: {
      id: row.userId,
      account: row.account,
      email: row.email,
      avatar: row.avatar,
    },
    tokens,
  }
}

export async function findPermissionsByUserId(userId: string): Promise<string[]> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      permission: userPermissions.permission,
    })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))
    .orderBy(asc(userPermissions.permission))
  return rows.map(row => row.permission)
}

export async function updateUserPassword(userId: string, newPassword: string) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      mustChangePassword: 0,
      updatedAt: now,
    })
    .where(eq(users.id, userId))

  await revokeSessionsByUserId(userId)

  const state = await getAuthForcePasswordChangeState()
  if (state?.pending) {
    await saveAuthForcePasswordChangeState({
      pending: false,
      completed: true,
    })
  }
}

export async function getSystemNetworkConfig(): Promise<DbSystemNetworkConfig | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      value: systemSettings.value,
    })
    .from(systemSettings)
    .where(eq(systemSettings.key, 'network.config'))
    .limit(1)

  const row = rows[0]
  if (!row?.value) {
    return undefined
  }
  return JSON.parse(row.value) as DbSystemNetworkConfig
}

export async function saveSystemNetworkConfig(config: DbSystemNetworkConfig) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .insert(systemSettings)
    .values({
      key: 'network.config',
      value: JSON.stringify(config),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: JSON.stringify(config),
        updatedAt: now,
      },
    })
}

function normalizePanelSettings(raw: unknown): DbSystemPanelSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      panelPort: 80,
      theme: 'system',
      autoUpdate: true,
      checkUpdateBeforeStart: false,
      updateCheckIntervalHours: 3,
    }
  }
  const value = raw as Partial<DbSystemPanelSettings>
  const panelPort = Number.isInteger(value.panelPort) ? value.panelPort as number : 80
  const theme = value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
    ? value.theme
    : 'system'
  return {
    panelPort: panelPort > 0 && panelPort <= 65535 ? panelPort : 80,
    theme,
    autoUpdate: typeof value.autoUpdate === 'boolean' ? value.autoUpdate : true,
    checkUpdateBeforeStart: typeof value.checkUpdateBeforeStart === 'boolean'
      ? value.checkUpdateBeforeStart
      : false,
    updateCheckIntervalHours: Number.isFinite(value.updateCheckIntervalHours)
      && (value.updateCheckIntervalHours as number) > 0
      ? Math.min(168, Math.max(1, Math.trunc(value.updateCheckIntervalHours as number)))
      : 1,
  }
}

function normalizeSteamcmdConfig(raw: unknown): DbSystemSteamcmdConfig {
  const defaultConfig: DbSystemSteamcmdConfig = {
    steamcmdPath: process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd',
    installRoot: process.platform === 'win32'
      ? path.resolve(process.cwd(), 'data', 'instances')
      : '/var/lib/game-server-hub/instances',
  }
  if (!raw || typeof raw !== 'object') {
    return defaultConfig
  }
  const value = raw as Partial<DbSystemSteamcmdConfig>
  const steamcmdPath = value.steamcmdPath?.trim() || defaultConfig.steamcmdPath
  const installRoot = value.installRoot?.trim() || defaultConfig.installRoot
  return {
    steamcmdPath,
    installRoot,
  }
}

export async function getSystemPanelSettings(): Promise<DbSystemPanelSettings | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      value: systemSettings.value,
    })
    .from(systemSettings)
    .where(eq(systemSettings.key, 'panel.settings'))
    .limit(1)

  const row = rows[0]
  if (!row?.value) {
    return undefined
  }
  return normalizePanelSettings(JSON.parse(row.value))
}

export async function saveSystemPanelSettings(settings: DbSystemPanelSettings) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .insert(systemSettings)
    .values({
      key: 'panel.settings',
      value: JSON.stringify(settings),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: JSON.stringify(settings),
        updatedAt: now,
      },
    })
}

export async function getSystemSteamcmdConfig(): Promise<DbSystemSteamcmdConfig | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      value: systemSettings.value,
    })
    .from(systemSettings)
    .where(eq(systemSettings.key, 'steamcmd.config'))
    .limit(1)
  const row = rows[0]
  if (!row?.value) {
    return undefined
  }
  return normalizeSteamcmdConfig(JSON.parse(row.value))
}

export async function saveSystemSteamcmdConfig(config: DbSystemSteamcmdConfig) {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  const normalized = normalizeSteamcmdConfig(config)
  await drizzleDb
    .insert(systemSettings)
    .values({
      key: 'steamcmd.config',
      value: JSON.stringify(normalized),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: JSON.stringify(normalized),
        updatedAt: now,
      },
    })
}

function normalizeNodeUsage(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, Number(value.toFixed(2))))
}

export async function saveServerNode(input: SaveServerNodeInput): Promise<DbServerNode> {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  const payload: DbServerNode = {
    id: input.id,
    name: input.name,
    host: input.host,
    sshPort: Number.isInteger(input.sshPort) ? input.sshPort as number : 22,
    status: input.status ?? 'offline',
    cpuUsage: normalizeNodeUsage(input.cpuUsage),
    memoryUsage: normalizeNodeUsage(input.memoryUsage),
    diskUsage: normalizeNodeUsage(input.diskUsage),
    lastHeartbeatAt: input.lastHeartbeatAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await drizzleDb
    .insert(serverNodes)
    .values(payload)
    .onConflictDoUpdate({
      target: serverNodes.id,
      set: {
        name: payload.name,
        host: payload.host,
        sshPort: payload.sshPort,
        status: payload.status,
        cpuUsage: payload.cpuUsage,
        memoryUsage: payload.memoryUsage,
        diskUsage: payload.diskUsage,
        lastHeartbeatAt: payload.lastHeartbeatAt,
        updatedAt: now,
      },
    })
  const current = await getServerNodeById(input.id)
  if (!current) {
    throw new Error(`server node upsert failed: ${input.id}`)
  }
  return current
}

export async function getServerNodeById(id: string): Promise<DbServerNode | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      id: serverNodes.id,
      name: serverNodes.name,
      host: serverNodes.host,
      sshPort: serverNodes.sshPort,
      status: serverNodes.status,
      cpuUsage: serverNodes.cpuUsage,
      memoryUsage: serverNodes.memoryUsage,
      diskUsage: serverNodes.diskUsage,
      lastHeartbeatAt: serverNodes.lastHeartbeatAt,
      createdAt: serverNodes.createdAt,
      updatedAt: serverNodes.updatedAt,
    })
    .from(serverNodes)
    .where(eq(serverNodes.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return undefined
  }
  return {
    ...row,
    status: row.status === 'online' ? 'online' : 'offline',
    cpuUsage: Number(row.cpuUsage),
    memoryUsage: Number(row.memoryUsage),
    diskUsage: Number(row.diskUsage),
  }
}

export async function listServerNodes(): Promise<DbServerNode[]> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      id: serverNodes.id,
      name: serverNodes.name,
      host: serverNodes.host,
      sshPort: serverNodes.sshPort,
      status: serverNodes.status,
      cpuUsage: serverNodes.cpuUsage,
      memoryUsage: serverNodes.memoryUsage,
      diskUsage: serverNodes.diskUsage,
      lastHeartbeatAt: serverNodes.lastHeartbeatAt,
      createdAt: serverNodes.createdAt,
      updatedAt: serverNodes.updatedAt,
    })
    .from(serverNodes)
    .orderBy(asc(serverNodes.createdAt))
  return rows.map(row => ({
    ...row,
    status: row.status === 'online' ? 'online' : 'offline',
    cpuUsage: Number(row.cpuUsage),
    memoryUsage: Number(row.memoryUsage),
    diskUsage: Number(row.diskUsage),
  }))
}

function normalizeInstanceStatus(status: string | undefined): DbGameInstanceStatus {
  if (status === 'pending_install' || status === 'running' || status === 'stopped' || status === 'installing' || status === 'error') {
    return status
  }
  return 'stopped'
}

function normalizeOptionalPort(value: number | null | undefined): number | null {
  if (value === null || typeof value === 'undefined') {
    return null
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null
  }
  return value
}

function mapDbGameInstance(row: {
  id: string
  nodeId: string
  name: string
  gameCode: string
  status: string
  containerId: string | null
  runtimePid: number | null
  runtimeStartedAt: string | null
  installPath: string | null
  configPath: string | null
  queryPort: number | null
  gamePort: number | null
  rconPort: number | null
  lastCommand: string | null
  lastExitCode: number | null
  lastError: string | null
  installLogStatus: string | null
  installPercent: number | null
  installLogUpdatedAt: string | null
  updateAvailable: number | null
  localBuildId: string | null
  remoteBuildId: string | null
  updateCheckedAt: string | null
  createdAt: string
  updatedAt: string
}): DbGameInstance {
  const installLogStatus = row.installLogStatus?.trim()
  return {
    ...row,
    status: normalizeInstanceStatus(row.status),
    runtimePid: row.runtimePid === null ? null : Number(row.runtimePid),
    runtimeStartedAt: row.runtimeStartedAt?.trim() || null,
    queryPort: row.queryPort === null ? null : Number(row.queryPort),
    gamePort: row.gamePort === null ? null : Number(row.gamePort),
    rconPort: row.rconPort === null ? null : Number(row.rconPort),
    lastExitCode: row.lastExitCode === null ? null : Number(row.lastExitCode),
    installLogStatus: installLogStatus === 'running' || installLogStatus === 'success' || installLogStatus === 'failed'
      ? installLogStatus
      : null,
    installPercent: row.installPercent === null ? null : Number(row.installPercent),
    installLogUpdatedAt: row.installLogUpdatedAt ?? null,
    updateAvailable: Number(row.updateAvailable ?? 0) === 1,
    localBuildId: row.localBuildId ?? null,
    remoteBuildId: row.remoteBuildId ?? null,
    updateCheckedAt: row.updateCheckedAt ?? null,
  }
}

function gameInstanceSelectFields() {
  return {
    id: gameInstances.id,
    nodeId: gameInstances.nodeId,
    name: gameInstances.name,
    gameCode: gameInstances.gameCode,
    status: gameInstances.status,
    containerId: gameInstances.containerId,
    runtimePid: gameInstances.runtimePid,
    runtimeStartedAt: gameInstances.runtimeStartedAt,
    installPath: gameInstances.installPath,
    configPath: gameInstances.configPath,
    queryPort: gameInstances.queryPort,
    gamePort: gameInstances.gamePort,
    rconPort: gameInstances.rconPort,
    lastCommand: gameInstances.lastCommand,
    lastExitCode: gameInstances.lastExitCode,
    lastError: gameInstances.lastError,
    installLogStatus: gameInstances.installLogStatus,
    installPercent: gameInstances.installPercent,
    installLogUpdatedAt: gameInstances.installLogUpdatedAt,
    updateAvailable: gameInstances.updateAvailable,
    localBuildId: gameInstances.localBuildId,
    remoteBuildId: gameInstances.remoteBuildId,
    updateCheckedAt: gameInstances.updateCheckedAt,
    createdAt: gameInstances.createdAt,
    updatedAt: gameInstances.updatedAt,
  }
}

export async function createGameInstance(input: CreateGameInstanceInput): Promise<DbGameInstance> {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  const id = input.id?.trim() || randomUUID()
  await drizzleDb
    .insert(gameInstances)
    .values({
      id,
      nodeId: input.nodeId,
      name: input.name,
      gameCode: input.gameCode,
      status: input.status ?? 'stopped',
      containerId: input.containerId ?? null,
      runtimePid: input.runtimePid ?? null,
      installPath: input.installPath ?? null,
      configPath: input.configPath ?? null,
      queryPort: normalizeOptionalPort(input.queryPort),
      gamePort: normalizeOptionalPort(input.gamePort),
      rconPort: normalizeOptionalPort(input.rconPort),
      lastCommand: input.lastCommand ?? null,
      lastExitCode: input.lastExitCode ?? null,
      lastError: input.lastError ?? null,
      createdAt: now,
      updatedAt: now,
    })
  const created = await getGameInstanceById(id)
  if (!created) {
    throw new Error(`create game instance failed: ${id}`)
  }
  return created
}

export async function getGameInstanceById(id: string): Promise<DbGameInstance | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select(gameInstanceSelectFields())
    .from(gameInstances)
    .where(eq(gameInstances.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return undefined
  }
  return mapDbGameInstance(row)
}

export async function listGameInstances(filters?: {
  nodeId?: string
  status?: DbGameInstanceStatus
  keyword?: string
}): Promise<DbGameInstance[]> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select(gameInstanceSelectFields())
    .from(gameInstances)
    .orderBy(asc(gameInstances.createdAt))

  const keyword = filters?.keyword?.trim().toLowerCase() ?? ''
  return rows
    .map(mapDbGameInstance)
    .filter((item) => {
      if (filters?.nodeId && item.nodeId !== filters.nodeId) {
        return false
      }
      if (filters?.status && item.status !== filters.status) {
        return false
      }
      if (!keyword) {
        return true
      }
      return item.name.toLowerCase().includes(keyword)
        || item.gameCode.toLowerCase().includes(keyword)
    })
}

export async function updateGameInstanceStatus(id: string, status: DbGameInstanceStatus): Promise<DbGameInstance | undefined> {
  const { drizzleDb } = ensureDb()
  await drizzleDb
    .update(gameInstances)
    .set({
      status,
      updatedAt: nowIso(),
    })
    .where(eq(gameInstances.id, id))
  return getGameInstanceById(id)
}

export async function updateGameInstanceRuntime(
  id: string,
  input: UpdateGameInstanceRuntimeInput,
): Promise<DbGameInstance | undefined> {
  const { drizzleDb } = ensureDb()
  const setPayload: {
    status?: DbGameInstanceStatus
    containerId?: string | null
    runtimePid?: number | null
    runtimeStartedAt?: string | null
    gamePort?: number | null
    lastCommand?: string | null
    lastExitCode?: number | null
    lastError?: string | null
    installLogStatus?: DbInstallLogStatus | null
    installPercent?: number | null
    installLogUpdatedAt?: string | null
    updateAvailable?: number
    localBuildId?: string | null
    remoteBuildId?: string | null
    updateCheckedAt?: string | null
    updatedAt: string
  } = {
    updatedAt: nowIso(),
  }
  if (typeof input.status !== 'undefined') {
    setPayload.status = input.status
  }
  if (typeof input.containerId !== 'undefined') {
    setPayload.containerId = input.containerId
  }
  if (typeof input.runtimePid !== 'undefined') {
    setPayload.runtimePid = Number.isInteger(input.runtimePid) ? input.runtimePid : null
  }
  if (typeof input.runtimeStartedAt !== 'undefined') {
    setPayload.runtimeStartedAt = input.runtimeStartedAt?.trim() || null
  }
  if (typeof input.gamePort !== 'undefined') {
    setPayload.gamePort = normalizeOptionalPort(input.gamePort)
  }
  if (typeof input.lastCommand !== 'undefined') {
    setPayload.lastCommand = input.lastCommand?.trim() || null
  }
  if (typeof input.lastExitCode !== 'undefined') {
    setPayload.lastExitCode = Number.isInteger(input.lastExitCode) ? input.lastExitCode : null
  }
  if (typeof input.lastError !== 'undefined') {
    setPayload.lastError = input.lastError?.trim() || null
  }
  if (typeof input.installLogStatus !== 'undefined') {
    setPayload.installLogStatus = input.installLogStatus
  }
  if (typeof input.installPercent !== 'undefined') {
    const percent = input.installPercent
    setPayload.installPercent = percent === null
      ? null
      : Number.isInteger(percent)
        ? Math.max(0, Math.min(100, percent))
        : null
  }
  if (typeof input.installLogUpdatedAt !== 'undefined') {
    setPayload.installLogUpdatedAt = input.installLogUpdatedAt?.trim() || null
  }
  if (typeof input.updateAvailable !== 'undefined') {
    setPayload.updateAvailable = input.updateAvailable ? 1 : 0
  }
  if (typeof input.localBuildId !== 'undefined') {
    setPayload.localBuildId = input.localBuildId?.trim() || null
  }
  if (typeof input.remoteBuildId !== 'undefined') {
    setPayload.remoteBuildId = input.remoteBuildId?.trim() || null
  }
  if (typeof input.updateCheckedAt !== 'undefined') {
    setPayload.updateCheckedAt = input.updateCheckedAt?.trim() || null
  }
  await drizzleDb
    .update(gameInstances)
    .set(setPayload)
    .where(eq(gameInstances.id, id))
  return getGameInstanceById(id)
}

export async function deleteGameInstanceById(id: string): Promise<boolean> {
  const { drizzleDb } = ensureDb()
  const exists = await getGameInstanceById(id)
  if (!exists) {
    return false
  }
  await drizzleDb
    .delete(gameInstances)
    .where(eq(gameInstances.id, id))
  return true
}

export type DbMaintenancePushStatus = 'success' | 'failed'

export interface DbMaintenanceDraft {
  instanceId: string
  message: string
  updatedAt: string
}

export interface DbMaintenancePushLog {
  id: string
  instanceId: string
  message: string
  operatorAccount: string
  status: DbMaintenancePushStatus
  errorMessage: string | null
  pushedAt: string
}

const DEFAULT_MAINTENANCE_PUSH_LOG_LIMIT = 20

export async function getMaintenanceDraft(instanceId: string): Promise<DbMaintenanceDraft | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      instanceId: instanceMaintenanceDrafts.instanceId,
      message: instanceMaintenanceDrafts.message,
      updatedAt: instanceMaintenanceDrafts.updatedAt,
    })
    .from(instanceMaintenanceDrafts)
    .where(eq(instanceMaintenanceDrafts.instanceId, instanceId))
    .limit(1)
  return rows[0]
}

export async function upsertMaintenanceDraft(instanceId: string, message: string): Promise<DbMaintenanceDraft> {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  const existing = await getMaintenanceDraft(instanceId)
  if (existing) {
    await drizzleDb
      .update(instanceMaintenanceDrafts)
      .set({
        message,
        updatedAt: now,
      })
      .where(eq(instanceMaintenanceDrafts.instanceId, instanceId))
  }
  else {
    await drizzleDb.insert(instanceMaintenanceDrafts).values({
      instanceId,
      message,
      updatedAt: now,
    })
  }
  return {
    instanceId,
    message,
    updatedAt: now,
  }
}

export async function listMaintenancePushLogs(
  instanceId: string,
  limit = DEFAULT_MAINTENANCE_PUSH_LOG_LIMIT,
): Promise<DbMaintenancePushLog[]> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({
      id: instanceMaintenancePushLogs.id,
      instanceId: instanceMaintenancePushLogs.instanceId,
      message: instanceMaintenancePushLogs.message,
      operatorAccount: instanceMaintenancePushLogs.operatorAccount,
      status: instanceMaintenancePushLogs.status,
      errorMessage: instanceMaintenancePushLogs.errorMessage,
      pushedAt: instanceMaintenancePushLogs.pushedAt,
    })
    .from(instanceMaintenancePushLogs)
    .where(eq(instanceMaintenancePushLogs.instanceId, instanceId))
    .orderBy(desc(instanceMaintenancePushLogs.pushedAt))
    .limit(limit)
  return rows.map(row => ({
    ...row,
    status: row.status as DbMaintenancePushStatus,
  }))
}

export interface InsertMaintenancePushLogInput {
  instanceId: string
  message: string
  operatorAccount: string
  status: DbMaintenancePushStatus
  errorMessage?: string | null
}

export async function insertMaintenancePushLog(input: InsertMaintenancePushLogInput): Promise<DbMaintenancePushLog> {
  const { drizzleDb } = ensureDb()
  const row: DbMaintenancePushLog = {
    id: randomUUID(),
    instanceId: input.instanceId,
    message: input.message,
    operatorAccount: input.operatorAccount,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    pushedAt: nowIso(),
  }
  await drizzleDb.insert(instanceMaintenancePushLogs).values({
    id: row.id,
    instanceId: row.instanceId,
    message: row.message,
    operatorAccount: row.operatorAccount,
    status: row.status,
    errorMessage: row.errorMessage,
    pushedAt: row.pushedAt,
  })
  return row
}
