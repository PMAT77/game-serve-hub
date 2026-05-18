export type ConsoleLogStream = 'stdout' | 'stderr' | 'system'

export interface ConsoleLogLine {
  id: number
  stream: ConsoleLogStream
  text: string
  at: string
}

type LogListener = (line: ConsoleLogLine) => void

const MAX_LOG_LINES = 2000

class InstanceConsoleLogStore {
  private readonly logs = new Map<string, ConsoleLogLine[]>()
  private readonly listeners = new Map<string, Set<LogListener>>()
  private seq = 0

  listLogs(instanceId: string, afterId = 0, limit = 500): ConsoleLogLine[] {
    const rows = this.logs.get(instanceId) ?? []
    const filtered = afterId > 0 ? rows.filter(row => row.id > afterId) : rows
    if (filtered.length <= limit) {
      return filtered
    }
    return filtered.slice(filtered.length - limit)
  }

  clearLogs(instanceId: string) {
    this.logs.set(instanceId, [])
    this.appendSystem(instanceId, '控制台日志已清空')
  }

  subscribe(instanceId: string, listener: LogListener): () => void {
    let set = this.listeners.get(instanceId)
    if (!set) {
      set = new Set()
      this.listeners.set(instanceId, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set && set.size === 0) {
        this.listeners.delete(instanceId)
      }
    }
  }

  appendSystem(instanceId: string, text: string) {
    this.pushLine(instanceId, 'system', text)
  }

  appendDockerLine(instanceId: string, text: string) {
    this.pushLine(instanceId, 'stdout', text)
  }

  private pushLine(instanceId: string, stream: ConsoleLogStream, text: string) {
    const line: ConsoleLogLine = {
      id: ++this.seq,
      stream,
      text,
      at: new Date().toISOString(),
    }
    let rows = this.logs.get(instanceId)
    if (!rows) {
      rows = []
      this.logs.set(instanceId, rows)
    }
    rows.push(line)
    if (rows.length > MAX_LOG_LINES) {
      rows.splice(0, rows.length - MAX_LOG_LINES)
    }
    const set = this.listeners.get(instanceId)
    if (set) {
      for (const listener of set) {
        listener(line)
      }
    }
  }
}

export const instanceConsoleLogStore = new InstanceConsoleLogStore()
