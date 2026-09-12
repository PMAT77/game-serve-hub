/**
 * DST Lua 覆盖配置的通用解析/校验。
 *
 * 面板只与 `overrides = { key="value", ... }` 这一块打交道：
 * - worldgenoverride.lua（面板写入的唯一真源：预设 + 全部覆盖项）
 * - leveldataoverride.lua（历史版本写入的文件，仅用于迁移解析）
 * 两个文件的块结构一致，解析实现只保留这一份，避免两套逻辑漂移。
 */

const OVERRIDE_ENTRY_RE = /^\s*([a-zA-Z0-9_]+)\s*=\s*["']([^"']*)["']\s*,?\s*$/
const OVERRIDE_KEY_RE = /^[a-z][a-z0-9_]*$/
// 与 shared/contracts/shard.ts overrideValueSchema 保持一致（允许空格：'highly random'）
const OVERRIDE_VALUE_RE = /^[a-zA-Z0-9_.+ -]+$/

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

/** 定位 `overrides = { ... }` 块的内容边界（不含花括号本身） */
export function findOverridesBlockBounds(content: string): { start: number, end: number } | null {
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

/** 读取 overrides 块里的键值对；没有该块时返回空对象 */
export function parseOverridesBlock(content: string): Record<string, string> {
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

/**
 * 渲染 `overrides = { ... }` 块。
 * 键排序保证同一份配置写入结果稳定（便于备份 diff 与人工排查）；值一律加引号，
 * DST 的 overrides 取值本身就是字符串（'default' / 'highly random' / 'true'）。
 */
export function buildOverridesBlock(overrides: Record<string, string>, indent = '  '): string {
  const keys = Object.keys(overrides).sort()
  const lines = keys.map(key => `${indent}${indent}${key}="${overrides[key]}",`)
  if (lines.length === 0) {
    return `${indent}overrides = {},`
  }
  return [
    `${indent}overrides = {`,
    ...lines,
    `${indent}},`,
  ].join('\n')
}
