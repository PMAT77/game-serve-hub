import fs from 'node:fs'
import path from 'node:path'

const MAX_LINES = 500

export function resolveInstallLogsDir(dbPath: string) {
  return path.join(path.dirname(dbPath), 'install-logs')
}

export function resolveInstallLogFilePath(installLogsDir: string, instanceId: string) {
  return path.join(installLogsDir, `${instanceId}.log`)
}

export function ensureInstallLogsDir(installLogsDir: string) {
  fs.mkdirSync(installLogsDir, { recursive: true })
}

export function readInstallLogContent(installLogsDir: string, instanceId: string): string | null {
  const filePath = resolveInstallLogFilePath(installLogsDir, instanceId)
  if (!fs.existsSync(filePath)) {
    return null
  }
  const content = fs.readFileSync(filePath, 'utf8').trimEnd()
  return content || null
}

export function deleteInstallLogFile(installLogsDir: string, instanceId: string) {
  const filePath = resolveInstallLogFilePath(installLogsDir, instanceId)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export class InstanceInstallLogWriter {
  private readonly filePath: string
  private lineCount = 0

  constructor(installLogsDir: string, instanceId: string) {
    ensureInstallLogsDir(installLogsDir)
    this.filePath = resolveInstallLogFilePath(installLogsDir, instanceId)
  }

  clear() {
    this.lineCount = 0
    fs.writeFileSync(this.filePath, '', 'utf8')
  }

  appendLine(line: string) {
    const text = line.trim()
    if (!text) {
      return
    }
    if (this.lineCount >= MAX_LINES) {
      this.trimFileToMaxLines()
    }
    fs.appendFileSync(this.filePath, `${text}\n`, 'utf8')
    this.lineCount += 1
  }

  readContent(): string {
    if (!fs.existsSync(this.filePath)) {
      return ''
    }
    return fs.readFileSync(this.filePath, 'utf8').trimEnd()
  }

  private trimFileToMaxLines() {
    if (!fs.existsSync(this.filePath)) {
      this.lineCount = 0
      return
    }
    const lines = fs.readFileSync(this.filePath, 'utf8')
      .split('\n')
      .map(line => line.trimEnd())
      .filter(line => line.length > 0)
    const trimmed = lines.slice(-MAX_LINES)
    fs.writeFileSync(this.filePath, trimmed.length > 0 ? `${trimmed.join('\n')}\n` : '', 'utf8')
    this.lineCount = trimmed.length
  }
}
