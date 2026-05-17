import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { z } from 'zod'

const envSchema = z.object({
  SERVER_HOST: z.string().trim().min(1).default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(9527),
  DB_PATH: z.string().trim().min(1).default('./data/game-server-hub.sqlite'),
  SERVER_LOG_DIR: z.string().trim().min(1).default('./logs'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FORCE_PASSWORD_CHANGE: z.string().trim().optional(),
  ADMIN_USERNAME: z.string().trim().optional(),
  ADMIN_PASSWORD: z.string().optional(),
})

function resolveMode() {
  const current = process.env.NODE_ENV
  if (current === 'test' || current === 'production') {
    return current
  }
  return 'development'
}

function getServerRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}

export interface ServerConfig {
  mode: 'development' | 'test' | 'production'
  host: string
  port: number
  dbPath: string
  logDir: string
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  envFile: string
  forcePasswordChange: boolean
  adminUsername: string
  adminPassword: string
}

export function loadServerConfig(): ServerConfig {
  const mode = resolveMode()
  const serverRootDir = getServerRootDir()
  const env = loadEnv(mode, serverRootDir, '')
  const merged = {
    SERVER_HOST: process.env.SERVER_HOST ?? env.SERVER_HOST,
    SERVER_PORT: process.env.SERVER_PORT ?? env.SERVER_PORT,
    DB_PATH: process.env.DB_PATH ?? env.DB_PATH,
    SERVER_LOG_DIR: process.env.SERVER_LOG_DIR ?? env.SERVER_LOG_DIR,
    LOG_LEVEL: process.env.LOG_LEVEL ?? env.LOG_LEVEL,
    FORCE_PASSWORD_CHANGE: process.env.FORCE_PASSWORD_CHANGE ?? env.FORCE_PASSWORD_CHANGE,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? env.ADMIN_PASSWORD,
  }
  const parsed = envSchema.parse(merged)
  return {
    mode,
    host: parsed.SERVER_HOST,
    port: parsed.SERVER_PORT,
    dbPath: path.resolve(serverRootDir, parsed.DB_PATH),
    logDir: path.resolve(serverRootDir, parsed.SERVER_LOG_DIR),
    logLevel: parsed.LOG_LEVEL,
    envFile: path.resolve(serverRootDir, `.env.${mode}`),
    forcePasswordChange: isTruthyEnv(parsed.FORCE_PASSWORD_CHANGE),
    adminUsername: parsed.ADMIN_USERNAME || 'admin',
    adminPassword: parsed.ADMIN_PASSWORD ?? '',
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function resolveInstallLogsDir(dbPath: string) {
  return path.join(path.dirname(dbPath), 'install-logs')
}

export function ensureServerRuntimeDirs(config: Pick<ServerConfig, 'dbPath' | 'logDir'>) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  fs.mkdirSync(config.logDir, { recursive: true })
  fs.mkdirSync(resolveInstallLogsDir(config.dbPath), { recursive: true })
}
