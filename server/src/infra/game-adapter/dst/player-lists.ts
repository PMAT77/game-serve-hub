import fs from 'node:fs'
import path from 'node:path'
import { PLAYER_KU_ID_PATTERN } from '../../../../../shared/constants/player'
import type { PlayerListEntry, PlayerListKind } from '../../../../../shared/contracts/player'
import { backupFile, writeFileAtomic } from './atomic-write'

export const PLAYER_LIST_FILE_NAMES: Record<PlayerListKind, string> = {
  admin: 'adminlist.txt',
  block: 'blocklist.txt',
  whitelist: 'whitelist.txt',
}

export const PLAYER_LIST_MAX_ENTRIES = 500

export function resolvePlayerListPath(clusterRoot: string, kind: PlayerListKind): string {
  return path.join(clusterRoot, PLAYER_LIST_FILE_NAMES[kind])
}

/**
 * 从一行里取出 KU ID：只认第一个空白分隔的 token。
 *
 * 为什么只取第一个 token：DST 按行读取这些名单文件，其它面板或人工整理的
 * 文件可能在 ID 后面跟随备注。读取时容忍备注，写入时不生成备注（见 buildPlayerList）。
 */
export function normalizeKuId(rawLine: string): string | null {
  const token = rawLine.trim().split(/\s+/)[0] ?? ''
  return PLAYER_KU_ID_PATTERN.test(token) ? token : null
}

/** 按首次出现顺序去重，比对时忽略大小写，保留原有书写形式 */
export function normalizePlayerEntries(entries: PlayerListEntry[]): PlayerListEntry[] {
  const seen = new Set<string>()
  const result: PlayerListEntry[] = []
  for (const entry of entries) {
    const kuId = normalizeKuId(entry.kuId)
    if (!kuId) {
      continue
    }
    const key = kuId.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push({ kuId })
  }
  return result
}

export function parsePlayerList(content: string): {
  entries: PlayerListEntry[]
  warnings: string[]
} {
  const entries: PlayerListEntry[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      return
    }
    const kuId = normalizeKuId(line)
    if (!kuId) {
      warnings.push(`第 ${index + 1} 行不是有效的玩家 ID，已忽略`)
      return
    }
    const key = kuId.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    entries.push({ kuId })
  })
  return { entries, warnings }
}

/**
 * 只写 KU ID 本身，不写备注或注释：DST 直接按行读取该文件，
 * 附加内容有让整行失效的风险。空名单写成空文件，DST 可以正常读取。
 */
export function buildPlayerList(entries: PlayerListEntry[]): string {
  const lines = normalizePlayerEntries(entries).map(entry => entry.kuId)
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

export function validatePlayerListEntries(entries: PlayerListEntry[]): string[] {
  const errors: string[] = []
  if (entries.length > PLAYER_LIST_MAX_ENTRIES) {
    errors.push(`名单条目不能超过 ${PLAYER_LIST_MAX_ENTRIES} 条`)
  }
  for (const entry of entries) {
    if (!PLAYER_KU_ID_PATTERN.test(entry.kuId.trim())) {
      errors.push(`玩家 ID 无效：${entry.kuId}`)
    }
  }
  return errors
}

export function readPlayerList(clusterRoot: string, kind: PlayerListKind): {
  entries: PlayerListEntry[]
  fileExists: boolean
  warnings: string[]
} {
  const filePath = resolvePlayerListPath(clusterRoot, kind)
  if (!fs.existsSync(filePath)) {
    return { entries: [], fileExists: false, warnings: [] }
  }
  const parsed = parsePlayerList(fs.readFileSync(filePath, 'utf8'))
  return { entries: parsed.entries, fileExists: true, warnings: parsed.warnings }
}

/** 整表覆盖写入：先备份原文件，再原子替换 */
export function savePlayerList(
  clusterRoot: string,
  kind: PlayerListKind,
  entries: PlayerListEntry[],
): PlayerListEntry[] {
  const errors = validatePlayerListEntries(entries)
  if (errors.length > 0) {
    throw new Error(errors.join('；'))
  }
  const normalized = normalizePlayerEntries(entries)
  const filePath = resolvePlayerListPath(clusterRoot, kind)
  fs.mkdirSync(clusterRoot, { recursive: true })
  backupFile(filePath)
  writeFileAtomic(filePath, buildPlayerList(normalized))
  return normalized
}
