import type { ShardId } from '../../../../../shared/contracts/shard'

const OVERRIDE_ENTRY_RE = /^\s*([a-zA-Z0-9_]+)\s*=\s*["']([^"']*)["']\s*,?\s*$/
const OVERRIDE_KEY_RE = /^[a-z][a-z0-9_]*$/
const OVERRIDE_VALUE_RE = /^[a-zA-Z0-9_.+-]+$/

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

function formatOverridesBlock(overrides: Record<string, string>): string {
  const lines = Object.keys(overrides)
    .sort((a, b) => a.localeCompare(b))
    .map(key => `    ${key}="${overrides[key]}",`)
  return [
    '  overrides={',
    ...lines,
    '  },',
  ].join('\n')
}

function buildMinimalLeveldataContent(shardId: ShardId, overrides: Record<string, string>): string {
  const overridesBlock = formatOverridesBlock(overrides)
  if (shardId === 'master') {
    return [
      'return {',
      overridesBlock,
      '  location="forest",',
      '  version=4,',
      '}',
      '',
    ].join('\n')
  }
  return [
    'return {',
    overridesBlock,
    '  location="cave",',
    '  id="DST_CAVE",',
    '  version=4,',
    '}',
    '',
  ].join('\n')
}

export function mergeLeveldataOverrides(
  existingContent: string | null,
  patch: Record<string, string>,
  shardId: ShardId,
): string {
  if (!existingContent?.trim()) {
    return buildMinimalLeveldataContent(shardId, patch)
  }
  const current = parseLeveldataOverrides(existingContent)
  const merged = { ...current, ...patch }
  const bounds = findOverridesBlockBounds(existingContent)
  if (!bounds) {
    const trimmed = existingContent.trimEnd()
    const withoutClosing = trimmed.endsWith('}')
      ? trimmed.slice(0, -1).trimEnd()
      : trimmed
    const separator = withoutClosing.endsWith(',') || withoutClosing.endsWith('{') ? '\n' : ',\n'
    return `${withoutClosing}${separator}${formatOverridesBlock(merged)}\n}\n`
  }
  const before = existingContent.slice(0, bounds.start)
  const after = existingContent.slice(bounds.end)
  const inner = Object.keys(merged)
    .sort((a, b) => a.localeCompare(b))
    .map(key => `    ${key}="${merged[key]}",`)
    .join('\n')
  const innerBlock = inner ? `\n${inner}\n  ` : '\n  '
  return `${before}${innerBlock}${after}`
}
