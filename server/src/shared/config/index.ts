import { randomBytes } from 'node:crypto'
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
  DOCKER_HOST: z.string().trim().optional(),
  GSH_INSTANCES_ROOT: z.string().trim().optional(),
  GSH_BACKUPS_ROOT: z.string().trim().optional(),
  GSH_GAME_DST_IMAGE: z.string().trim().optional(),
  GSH_STEAMCMD_IMAGE: z.string().trim().optional(),
  GSH_EDITION: z.string().trim().optional(),
  PANEL_IMAGE: z.string().trim().optional(),
  GSH_STACK_DIR: z.string().trim().optional(),
  GSH_COMPOSE_FILES: z.string().trim().optional(),
  GSH_PANEL_CONTAINER_NAME: z.string().trim().optional(),
  GSH_GITHUB_REPO: z.string().trim().optional(),
  GSH_RELEASE_VERSION: z.string().trim().optional(),
  GSH_BUILD_SHA: z.string().trim().optional(),
  CORS_ORIGIN: z.string().trim().optional(),
  GSH_SYNC_ADMIN_PASSWORD_FROM_ENV: z.string().trim().optional(),
  GSH_PASSWORD_RECOVERY_TOKEN: z.string().trim().optional(),
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
  /** 生产环境未配置 ADMIN_PASSWORD 时自动生成 */
  adminPasswordGenerated: boolean
  dockerHost: string
  instancesRoot: string
  backupsRoot: string
  gameDstImage: string
  steamcmdImage: string
  edition: string
  panelImage: string
  stackDir: string
  composeFiles: string[]
  panelContainerName: string
  githubRepo: string
  releaseVersion: string
  buildSha: string
  syncAdminPasswordFromEnv: boolean
  passwordRecoveryToken: string
  /** Fastify @fastify/cors origin 选项；生产默认同源（false） */
  corsOrigin: boolean | string | string[]
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
    DOCKER_HOST: process.env.DOCKER_HOST ?? env.DOCKER_HOST,
    GSH_INSTANCES_ROOT: process.env.GSH_INSTANCES_ROOT ?? env.GSH_INSTANCES_ROOT,
    GSH_BACKUPS_ROOT: process.env.GSH_BACKUPS_ROOT ?? env.GSH_BACKUPS_ROOT,
    GSH_GAME_DST_IMAGE: process.env.GSH_GAME_DST_IMAGE ?? env.GSH_GAME_DST_IMAGE,
    GSH_STEAMCMD_IMAGE: process.env.GSH_STEAMCMD_IMAGE ?? env.GSH_STEAMCMD_IMAGE,
    GSH_EDITION: process.env.GSH_EDITION ?? env.GSH_EDITION,
    PANEL_IMAGE: process.env.PANEL_IMAGE ?? env.PANEL_IMAGE,
    GSH_STACK_DIR: process.env.GSH_STACK_DIR ?? env.GSH_STACK_DIR,
    GSH_COMPOSE_FILES: process.env.GSH_COMPOSE_FILES ?? env.GSH_COMPOSE_FILES,
    GSH_PANEL_CONTAINER_NAME: process.env.GSH_PANEL_CONTAINER_NAME ?? env.GSH_PANEL_CONTAINER_NAME,
    GSH_GITHUB_REPO: process.env.GSH_GITHUB_REPO ?? env.GSH_GITHUB_REPO,
    GSH_RELEASE_VERSION: process.env.GSH_RELEASE_VERSION ?? env.GSH_RELEASE_VERSION,
    GSH_BUILD_SHA: process.env.GSH_BUILD_SHA ?? env.GSH_BUILD_SHA,
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? env.CORS_ORIGIN,
    GSH_SYNC_ADMIN_PASSWORD_FROM_ENV: process.env.GSH_SYNC_ADMIN_PASSWORD_FROM_ENV ?? env.GSH_SYNC_ADMIN_PASSWORD_FROM_ENV,
    GSH_PASSWORD_RECOVERY_TOKEN: process.env.GSH_PASSWORD_RECOVERY_TOKEN ?? env.GSH_PASSWORD_RECOVERY_TOKEN,
  }
  const parsed = envSchema.parse(merged)
  const adminCredentials = resolveAdminCredentials(mode, parsed.ADMIN_USERNAME, parsed.ADMIN_PASSWORD)
  const defaultInstancesRoot = process.platform === 'win32'
    ? path.resolve(serverRootDir, 'data', 'instances')
    : '/var/lib/game-server-hub/instances'
  const defaultBackupsRoot = process.platform === 'win32'
    ? path.resolve(serverRootDir, 'data', 'backups')
    : '/var/lib/game-server-hub/backups'
  return {
    mode,
    host: parsed.SERVER_HOST,
    port: parsed.SERVER_PORT,
    dbPath: path.resolve(serverRootDir, parsed.DB_PATH),
    logDir: path.resolve(serverRootDir, parsed.SERVER_LOG_DIR),
    logLevel: parsed.LOG_LEVEL,
    envFile: path.resolve(serverRootDir, `.env.${mode}`),
    forcePasswordChange: isTruthyEnv(parsed.FORCE_PASSWORD_CHANGE),
    adminUsername: adminCredentials.username,
    adminPassword: adminCredentials.password,
    adminPasswordGenerated: adminCredentials.generated,
    dockerHost: parsed.DOCKER_HOST || (process.platform === 'win32'
      ? 'npipe:////./pipe/docker_engine'
      : 'unix:///var/run/docker.sock'),
    instancesRoot: path.resolve(parsed.GSH_INSTANCES_ROOT || defaultInstancesRoot),
    backupsRoot: path.resolve(parsed.GSH_BACKUPS_ROOT || defaultBackupsRoot),
    gameDstImage: parsed.GSH_GAME_DST_IMAGE || 'ghcr.io/gameserverhub/game-server-hub-dst:v0.1.3',
    steamcmdImage: parsed.GSH_STEAMCMD_IMAGE || 'ghcr.io/gameserverhub/steamcmd-base:v0.1.3',
    edition: parsed.GSH_EDITION || 'community',
    panelImage: parsed.PANEL_IMAGE || 'ghcr.io/gameserverhub/game-server-hub:v0.1.3',
    stackDir: parsed.GSH_STACK_DIR?.trim() || '',
    composeFiles: (parsed.GSH_COMPOSE_FILES?.trim() || 'docker-compose.yml:docker-compose.bind.yml')
      .split(':')
      .map(item => item.trim())
      .filter(Boolean),
    panelContainerName: parsed.GSH_PANEL_CONTAINER_NAME?.trim() || 'game-server-hub-panel',
    githubRepo: parsed.GSH_GITHUB_REPO?.trim() || 'GameServerHub/game-server-hub',
    releaseVersion: parsed.GSH_RELEASE_VERSION?.trim() || '',
    buildSha: parsed.GSH_BUILD_SHA?.trim() || '',
    syncAdminPasswordFromEnv: isTruthyEnv(parsed.GSH_SYNC_ADMIN_PASSWORD_FROM_ENV),
    passwordRecoveryToken: parsed.GSH_PASSWORD_RECOVERY_TOKEN?.trim() || '',
    corsOrigin: resolveCorsOrigin(mode, parsed.CORS_ORIGIN),
  }
}

export function resolveCorsOrigin(
  mode: ServerConfig['mode'],
  raw: string | undefined,
): boolean | string | string[] {
  const normalized = raw?.trim()
  if (normalized) {
    if (normalized === 'true' || normalized === '*') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
    return normalized.split(',').map(item => item.trim()).filter(Boolean)
  }
  return mode === 'development'
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function generateAdminPassword() {
  const entropy = randomBytes(12).toString('base64url')
  return `GsH!${entropy}9a`
}

function resolveAdminCredentials(
  mode: ServerConfig['mode'],
  envUsername: string | undefined,
  envPassword: string | undefined,
) {
  const username = envUsername?.trim() || 'superadmin'
  const password = envPassword?.trim()
  if (password) {
    return {
      username,
      password,
      generated: false,
    }
  }
  if (mode === 'production') {
    return {
      username,
      password: generateAdminPassword(),
      generated: true,
    }
  }
  return {
    username,
    password: '123456',
    generated: false,
  }
}

export function resolveInstallLogsDir(dbPath: string) {
  return path.join(path.dirname(dbPath), 'install-logs')
}

export function ensureServerRuntimeDirs(config: Pick<ServerConfig, 'dbPath' | 'logDir' | 'instancesRoot' | 'backupsRoot'>) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  fs.mkdirSync(config.logDir, { recursive: true })
  fs.mkdirSync(config.instancesRoot, { recursive: true })
  fs.mkdirSync(config.backupsRoot, { recursive: true })
  fs.mkdirSync(resolveInstallLogsDir(config.dbPath), { recursive: true })
}
