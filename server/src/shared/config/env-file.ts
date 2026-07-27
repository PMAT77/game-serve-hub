import fs from 'node:fs'
import path from 'node:path'

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function unwrapEnvValue(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2) {
    const quote = value[0]
    if ((quote === '"' || quote === '\'') && value.at(-1) === quote) {
      const inner = value.slice(1, -1)
      if (quote === '"') {
        return inner
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      }
      return inner
    }
  }
  return value.replace(/\s+#.*$/, '').trimEnd()
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const normalized = line.startsWith('export ') ? line.slice(7).trimStart() : line
    const separator = normalized.indexOf('=')
    if (separator <= 0) {
      continue
    }
    const key = normalized.slice(0, separator).trim()
    if (!ENV_KEY_PATTERN.test(key)) {
      continue
    }
    result[key] = unwrapEnvValue(normalized.slice(separator + 1))
  }
  return result
}

/**
 * Mirrors Vite's useful server-side env precedence without loading the Vite
 * build tool in production:
 * .env -> .env.local -> .env.<mode> -> .env.<mode>.local
 */
export function loadModeEnv(rootDir: string, mode: string): Record<string, string> {
  const result: Record<string, string> = {}
  const candidates = [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ]
  for (const filename of candidates) {
    const filePath = path.join(rootDir, filename)
    if (!fs.existsSync(filePath)) {
      continue
    }
    Object.assign(result, parseEnvFile(fs.readFileSync(filePath, 'utf8')))
  }
  return result
}
