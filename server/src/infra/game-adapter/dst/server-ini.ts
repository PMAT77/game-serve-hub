import type { ShardId } from '../../../../../shared/contracts/shard'
import { DST_DEFAULT_GAME_PORT } from './constants'

export interface ServerIniFields {
  isMaster: boolean
  shardName: string
  serverPort: number
  steamAuthPort: number
  steamMasterPort: number
}

const DEFAULT_MASTER_STEAM_AUTH = 8766
const DEFAULT_MASTER_STEAM_MASTER = 12346

function parseIni(content: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let currentSection = ''
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim().toUpperCase()
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map())
      }
      continue
    }
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }
    const key = line.slice(0, eqIndex).trim()
    const value = line.slice(eqIndex + 1).trim()
    if (!sections.has(currentSection)) {
      sections.set(currentSection, new Map())
    }
    sections.get(currentSection)!.set(key, value)
  }
  return sections
}

function getSectionValue(sections: Map<string, Map<string, string>>, section: string, key: string): string | undefined {
  return sections.get(section.toUpperCase())?.get(key)
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return fallback
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback
}

export function parseServerIni(content: string, shardId: ShardId): { fields: ServerIniFields, warnings: string[] } {
  const sections = parseIni(content)
  const warnings: string[] = []
  const isMaster = parseBool(getSectionValue(sections, 'SHARD', 'is_master'), shardId === 'master')
  const shardName = getSectionValue(sections, 'SHARD', 'name')?.trim() || (shardId === 'master' ? 'Master' : 'Caves')
  const defaultGamePort = shardId === 'master'
    ? DST_DEFAULT_GAME_PORT
    : DST_DEFAULT_GAME_PORT + 1
  const defaultSteamAuth = shardId === 'master'
    ? DEFAULT_MASTER_STEAM_AUTH
    : DEFAULT_MASTER_STEAM_AUTH + 2
  const defaultSteamMaster = shardId === 'master'
    ? DEFAULT_MASTER_STEAM_MASTER
    : DEFAULT_MASTER_STEAM_MASTER + 2
  const serverPort = parsePort(getSectionValue(sections, 'NETWORK', 'server_port'), defaultGamePort)
  const steamAuthPort = parsePort(getSectionValue(sections, 'STEAM', 'authentication_port'), defaultSteamAuth)
  const steamMasterPort = parsePort(getSectionValue(sections, 'STEAM', 'master_server_port'), defaultSteamMaster)
  if (shardId === 'master' && !isMaster) {
    warnings.push('Master 分片 server.ini 中 is_master 应为 true')
  }
  if (shardId === 'caves' && isMaster) {
    warnings.push('Caves 分片 server.ini 中 is_master 应为 false')
  }
  return {
    fields: {
      isMaster: shardId === 'master',
      shardName,
      serverPort,
      steamAuthPort,
      steamMasterPort,
    },
    warnings,
  }
}

export function buildServerIni(fields: ServerIniFields): string {
  return [
    '[SHARD]',
    `is_master = ${fields.isMaster}`,
    `name = ${fields.shardName}`,
    '',
    '[NETWORK]',
    `server_port = ${fields.serverPort}`,
    '',
    '[STEAM]',
    `authentication_port = ${fields.steamAuthPort}`,
    `master_server_port = ${fields.steamMasterPort}`,
    '',
    '[ACCOUNT]',
    'encode_user_path = true',
    '',
  ].join('\n')
}

export function defaultMasterServerIniFields(gamePort?: number): ServerIniFields {
  const serverPort = gamePort ?? DST_DEFAULT_GAME_PORT
  const offset = serverPort - DST_DEFAULT_GAME_PORT
  return {
    isMaster: true,
    shardName: 'Master',
    serverPort,
    steamAuthPort: DEFAULT_MASTER_STEAM_AUTH + offset,
    steamMasterPort: DEFAULT_MASTER_STEAM_MASTER + offset,
  }
}

export function defaultCavesServerIniFields(masterFields: ServerIniFields): ServerIniFields {
  return {
    isMaster: false,
    shardName: 'Caves',
    serverPort: masterFields.serverPort + 1,
    steamAuthPort: masterFields.steamAuthPort + 2,
    steamMasterPort: masterFields.steamMasterPort + 2,
  }
}

export function validateServerIniFields(fields: ServerIniFields, shardId: ShardId): string[] {
  const errors: string[] = []
  if (shardId === 'master' && !fields.isMaster) {
    errors.push('主世界分片 is_master 必须为 true')
  }
  if (shardId === 'caves' && fields.isMaster) {
    errors.push('洞穴分片 is_master 必须为 false')
  }
  for (const [label, port] of [
    ['游戏端口', fields.serverPort],
    ['Steam 认证端口', fields.steamAuthPort],
    ['Steam 主服端口', fields.steamMasterPort],
  ] as const) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`${label}须在 1–65535 之间`)
    }
  }
  return errors
}

export function collectPortSet(fields: ServerIniFields): number[] {
  return [fields.serverPort, fields.steamAuthPort, fields.steamMasterPort]
}

export function findPortConflictsBetweenShards(
  master: ServerIniFields,
  caves: ServerIniFields,
): string[] {
  const errors: string[] = []
  const pairs: Array<[string, number, string, number]> = [
    ['主世界游戏端口', master.serverPort, '洞穴游戏端口', caves.serverPort],
    ['主世界 Steam 认证端口', master.steamAuthPort, '洞穴 Steam 认证端口', caves.steamAuthPort],
    ['主世界 Steam 主服端口', master.steamMasterPort, '洞穴 Steam 主服端口', caves.steamMasterPort],
  ]
  for (const [aLabel, a, bLabel, b] of pairs) {
    if (a === b) {
      errors.push(`${aLabel}与${bLabel}不能相同（${a}）`)
    }
  }
  const allPorts = [...collectPortSet(master), ...collectPortSet(caves)]
  const seen = new Map<number, number>()
  for (const port of allPorts) {
    seen.set(port, (seen.get(port) ?? 0) + 1)
  }
  for (const [port, count] of seen) {
    if (count > 1) {
      errors.push(`端口 ${port} 在主世界与洞穴配置中重复`)
    }
  }
  return errors
}
