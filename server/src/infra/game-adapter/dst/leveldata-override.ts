import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ShardId } from '../../../../../shared/contracts/shard'
import { isCavesShardConfigured, resolveShardLeveldataPath } from './shard-layout'
import { writeFileAtomic } from './atomic-write'
import { resolveFirstExisting, resolveRepoRoot } from '../../../shared/repo-root'

const OVERRIDE_ENTRY_RE = /^\s*([a-zA-Z0-9_]+)\s*=\s*["']([^"']*)["']\s*,?\s*$/
const OVERRIDE_KEY_RE = /^[a-z][a-z0-9_]*$/
const OVERRIDE_VALUE_RE = /^[a-zA-Z0-9_.+-]+$/

const templateCache = new Map<ShardId, string>()

export function isValidOverrideKey(key: string): boolean {
  return OVERRIDE_KEY_RE.test(key) && key.length <= 64
}

export function isValidOverrideValue(value: string): boolean {
  return OVERRIDE_VALUE_RE.test(value) && value.length <= 64
}

export function validateWorldRuleOverrides(overrides: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(overrides)) {
    if (!isValidOverrideKey(key)) {
      return `世界规则键名无效：${key}`
    }
    if (!isValidOverrideValue(value)) {
      return `世界规则值无效：${key}=${value}`
    }
  }
  return null
}

/** Klei 官方 leveldata 须含 id/settings_id；面板旧版极简文件会导致启动崩溃 */
export function isValidLeveldataStructure(content: string): boolean {
  const text = content.trim()
  if (!text) {
    return false
  }
  return /\bid\s*=\s*["']/.test(text) && /\bsettings_id\s*=\s*["']/.test(text)
}

function resolveLeveldataTemplatePath(shardId: ShardId): string {
  const fileName = shardId === 'master' ? 'master-leveldataoverride.lua' : 'caves-leveldataoverride.lua'
  // tsx 直跑源码时模板与模块同目录；esbuild 打包后 build 脚本把 templates 拷到 dist-server/
  return resolveFirstExisting(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', fileName),
    path.join(resolveRepoRoot(), 'dist-server', 'templates', fileName),
  )
}

export function loadLeveldataTemplate(shardId: ShardId): string {
  const cached = templateCache.get(shardId)
  if (cached) {
    return cached
  }
  const content = fs.readFileSync(resolveLeveldataTemplatePath(shardId), 'utf8')
  templateCache.set(shardId, content)
  return content
}

function findOverridesBlockBounds(content: string): { start: number, end: number } | null {
  const marker = content.match(/\boverrides\s*=\s*\{/)
  if (!marker || marker.index === undefined) {
    return null
  }
  const openBrace = content.indexOf('{', marker.index)
  if (openBrace < 0) {
    return null
  }
  let depth = 0
  for (let i = openBrace; i < content.length; i++) {
    const ch = content[i]
    if (ch === '{') {
      depth++
    }
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return { start: openBrace + 1, end: i }
      }
    }
  }
  return null
}

export function parseLeveldataOverrides(content: string): Record<string, string> {
  const bounds = findOverridesBlockBounds(content)
  if (!bounds) {
    return {}
  }
  const block = content.slice(bounds.start, bounds.end)
  const overrides: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const match = line.match(OVERRIDE_ENTRY_RE)
    if (match) {
      overrides[match[1]!] = match[2]!
    }
  }
  return overrides
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function patchOverrideKeyInLeveldata(content: string, key: string, value: string): string {
  const bounds = findOverridesBlockBounds(content)
  if (!bounds) {
    return content
  }
  const before = content.slice(0, bounds.start)
  const block = content.slice(bounds.start, bounds.end)
  const after = content.slice(bounds.end)
  const keyRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'm')
  let found = false
  const newLines = block.split('\n').map((line) => {
    if (keyRe.test(line)) {
      found = true
      return `    ${key}="${value}",`
    }
    return line
  })
  if (!found) {
    newLines.push(`    ${key}="${value}",`)
  }
  return `${before}${newLines.join('\n')}${after}`
}

export function mergeLeveldataOverrides(
  existingContent: string | null,
  patch: Record<string, string>,
  shardId: ShardId,
): string {
  const template = loadLeveldataTemplate(shardId)
  let base = template
  if (existingContent?.trim() && isValidLeveldataStructure(existingContent)) {
    base = existingContent
  }
  const carryOver = existingContent?.trim() && !isValidLeveldataStructure(existingContent)
    ? parseLeveldataOverrides(existingContent)
    : {}
  const allPatches = { ...carryOver, ...patch }
  let result = base
  for (const [key, value] of Object.entries(allPatches)) {
    result = patchOverrideKeyInLeveldata(result, key, value)
  }
  return result
}

/** 启动/安装前修复旧版极简 leveldataoverride.lua，避免 DST 反复崩溃重启 */
export function repairInvalidLeveldataOverrideFile(installPath: string, shardId: ShardId): boolean {
  const luaPath = resolveShardLeveldataPath(installPath, shardId)
  if (!fs.existsSync(luaPath)) {
    return false
  }
  const content = fs.readFileSync(luaPath, 'utf8')
  if (isValidLeveldataStructure(content)) {
    return false
  }
  const preserved = parseLeveldataOverrides(content)
  if (Object.keys(preserved).length === 0) {
    fs.rmSync(luaPath, { force: true })
    return true
  }
  writeFileAtomic(luaPath, mergeLeveldataOverrides(null, preserved, shardId))
  return true
}

export function repairInvalidLeveldataOverrides(installPath: string): number {
  let repaired = 0
  if (repairInvalidLeveldataOverrideFile(installPath, 'master')) {
    repaired++
  }
  if (isCavesShardConfigured(installPath) && repairInvalidLeveldataOverrideFile(installPath, 'caves')) {
    repaired++
  }
  return repaired
}
