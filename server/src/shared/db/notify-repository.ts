import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { notifyChannels, systemSettings } from './schema/index'
import { ensureDb, nowIso } from './connection'
import type {
  CreateNotifyChannelInput,
  DbNotifyChannel,
  DbNotifyChannelType,
  DbNotifyHealthStatus,
  DbNotifySettings,
  UpdateNotifyChannelInput,
} from './types'

const CHANNEL_TYPES: DbNotifyChannelType[] = ['dingtalk', 'wecom', 'feishu', 'serverchan', 'pushplus']
const HEALTH_STATUSES: DbNotifyHealthStatus[] = ['healthy', 'failing']

const DEFAULT_NOTIFY_SETTINGS: DbNotifySettings = {
  enabled: true,
  cooldownMinutes: 15,
  thresholds: {
    cpuPercent: 90,
    memPercent: 90,
    diskPercent: 90,
  },
}

function normalizeType(type: string | null | undefined): DbNotifyChannelType {
  return CHANNEL_TYPES.includes(type as DbNotifyChannelType) ? type as DbNotifyChannelType : 'dingtalk'
}

function normalizeHealth(status: string | null | undefined): DbNotifyHealthStatus {
  return HEALTH_STATUSES.includes(status as DbNotifyHealthStatus) ? status as DbNotifyHealthStatus : 'healthy'
}

const CHANNEL_COLUMNS = {
  id: notifyChannels.id,
  type: notifyChannels.type,
  name: notifyChannels.name,
  config: notifyChannels.config,
  enabled: notifyChannels.enabled,
  healthStatus: notifyChannels.healthStatus,
  lastErrorAt: notifyChannels.lastErrorAt,
  lastErrorMessage: notifyChannels.lastErrorMessage,
  createdAt: notifyChannels.createdAt,
  updatedAt: notifyChannels.updatedAt,
}

function mapDbNotifyChannel(row: {
  id: string
  type: string | null
  name: string
  config: string
  enabled: number | null
  healthStatus: string | null
  lastErrorAt: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
}): DbNotifyChannel {
  return {
    id: row.id,
    type: normalizeType(row.type),
    name: row.name,
    config: row.config,
    enabled: row.enabled === 1,
    healthStatus: normalizeHealth(row.healthStatus),
    lastErrorAt: row.lastErrorAt,
    lastErrorMessage: row.lastErrorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function newNotifyChannelId(): string {
  return `nc-${randomUUID()}`
}

export async function createNotifyChannel(input: CreateNotifyChannelInput): Promise<DbNotifyChannel> {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb.insert(notifyChannels).values({
    id: input.id,
    type: input.type,
    name: input.name,
    config: input.config,
    enabled: input.enabled === false ? 0 : 1,
    healthStatus: 'healthy',
    lastErrorAt: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
  })
  const rows = await drizzleDb.select(CHANNEL_COLUMNS).from(notifyChannels).where(eq(notifyChannels.id, input.id)).limit(1)
  return mapDbNotifyChannel(rows[0])
}

export async function getNotifyChannelById(id: string): Promise<DbNotifyChannel | undefined> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb.select(CHANNEL_COLUMNS).from(notifyChannels).where(eq(notifyChannels.id, id)).limit(1)
  return rows[0] ? mapDbNotifyChannel(rows[0]) : undefined
}

export async function listNotifyChannels(): Promise<DbNotifyChannel[]> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb.select(CHANNEL_COLUMNS).from(notifyChannels).orderBy(asc(notifyChannels.createdAt))
  return rows.map(mapDbNotifyChannel)
}

export async function listEnabledNotifyChannels(): Promise<DbNotifyChannel[]> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb.select(CHANNEL_COLUMNS).from(notifyChannels).where(eq(notifyChannels.enabled, 1)).orderBy(asc(notifyChannels.createdAt))
  return rows.map(mapDbNotifyChannel)
}

export async function updateNotifyChannel(id: string, input: UpdateNotifyChannelInput): Promise<DbNotifyChannel | undefined> {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .update(notifyChannels)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.config === undefined ? {} : { config: input.config }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled ? 1 : 0 }),
      ...(input.healthStatus === undefined ? {} : { healthStatus: input.healthStatus }),
      ...(input.lastErrorAt === undefined ? {} : { lastErrorAt: input.lastErrorAt }),
      ...(input.lastErrorMessage === undefined ? {} : { lastErrorMessage: input.lastErrorMessage }),
      updatedAt: now,
    })
    .where(eq(notifyChannels.id, id))
  return getNotifyChannelById(id)
}

export async function deleteNotifyChannel(id: string): Promise<boolean> {
  const { drizzleDb } = ensureDb()
  const result = await drizzleDb.delete(notifyChannels).where(eq(notifyChannels.id, id)).returning({ id: notifyChannels.id })
  return result.length > 0
}

export async function getNotifySettings(): Promise<DbNotifySettings> {
  const { drizzleDb } = ensureDb()
  const rows = await drizzleDb
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, 'notify.settings'))
    .limit(1)
  const row = rows[0]
  if (!row?.value) {
    return { ...DEFAULT_NOTIFY_SETTINGS, thresholds: { ...DEFAULT_NOTIFY_SETTINGS.thresholds } }
  }
  try {
    const raw = JSON.parse(row.value) as Partial<DbNotifySettings>
    const cooldown = Number.isFinite(raw.cooldownMinutes) && (raw.cooldownMinutes as number) > 0
      ? Math.min(1440, Math.max(1, Math.trunc(raw.cooldownMinutes as number)))
      : DEFAULT_NOTIFY_SETTINGS.cooldownMinutes
    const thresholds = { ...DEFAULT_NOTIFY_SETTINGS.thresholds }
    if (raw.thresholds && typeof raw.thresholds === 'object') {
      for (const key of ['cpuPercent', 'memPercent', 'diskPercent'] as const) {
        const value = Number((raw.thresholds as Record<string, unknown>)[key])
        if (Number.isFinite(value) && value > 0 && value <= 100) {
          thresholds[key] = value
        }
      }
    }
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_NOTIFY_SETTINGS.enabled,
      cooldownMinutes: cooldown,
      thresholds,
    }
  }
  catch {
    return { ...DEFAULT_NOTIFY_SETTINGS, thresholds: { ...DEFAULT_NOTIFY_SETTINGS.thresholds } }
  }
}

export async function saveNotifySettings(settings: DbNotifySettings): Promise<void> {
  const { drizzleDb } = ensureDb()
  const now = nowIso()
  await drizzleDb
    .insert(systemSettings)
    .values({
      key: 'notify.settings',
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
