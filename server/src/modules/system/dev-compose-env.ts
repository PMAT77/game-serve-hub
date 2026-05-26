import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEV_WEB_PORT_KEY = 'VITE_DEV_WEB_PORT'

function resolvePanelEnvPath() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(moduleDir, '../../../../panel.env')
}

function upsertEnvVar(content: string, key: string, value: string) {
  const lines = content.split(/\r?\n/)
  let replaced = false
  const nextLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return line
    }
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      return line
    }
    const currentKey = line.slice(0, separatorIndex).trim()
    if (currentKey !== key) {
      return line
    }
    replaced = true
    return `${key}=${value}`
  })
  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== '') {
      nextLines.push('')
    }
    nextLines.push(`${key}=${value}`)
  }
  return `${nextLines.join('\n').replace(/\n+$/, '')}\n`
}

export function syncDevComposeWebPort(port: number) {
  if (process.env.NODE_ENV !== 'development') {
    return
  }
  const panelEnvPath = resolvePanelEnvPath()
  const nextPort = String(port)
  const raw = fs.existsSync(panelEnvPath) ? fs.readFileSync(panelEnvPath, 'utf8') : ''
  const next = upsertEnvVar(raw, DEV_WEB_PORT_KEY, nextPort)
  if (next === raw) {
    return
  }
  fs.writeFileSync(panelEnvPath, next, 'utf8')
}
