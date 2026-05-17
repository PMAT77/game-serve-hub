import type { ChildProcess } from 'node:child_process'

export type ConsoleLogStream = 'stdout' | 'stderr' | 'system'

export interface ConsoleLogLine {
  id: number
  stream: ConsoleLogStream
  text: string
  at: string
}

type LogListener = (line: ConsoleLogLine) => void

const MAX_LOG_LINES = 2000

class InstanceRuntimeRegistry {
  private readonly processes = new Map<string, ChildProcess>()
  private readonly logs = new Map<string, ConsoleLogLine[]>()
  private readonly listeners = new Map<string, Set<LogListener>>()
  private seq = 0

  getProcess(instanceId: string): ChildProcess | undefined {
    return this.processes.get(instanceId)
  }

  setProcess(instanceId: string, child: ChildProcess) {
    this.processes.set(instanceId, child)
    this.appendSystem(instanceId, '已连接实例进程，开始采集控制台输出')
    this.bindOutput(instanceId, child)
  }

  deleteProcess(instanceId: string) {
    if (this.processes.has(instanceId)) {
      this.appendSystem(instanceId, '实例进程已结束，控制台输出采集停止')
    }
    this.processes.delete(instanceId)
  }

  bindOutput(instanceId: string, child: ChildProcess) {
    child.stdout?.on('data', chunk => this.appendChunk(instanceId, 'stdout', chunk))
    child.stderr?.on('data', chunk => this.appendChunk(instanceId, 'stderr', chunk))
  }

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

  sendCommand(instanceId: string, command: string): { ok: boolean, message?: string } {
    const trimmed = command.trim()
    if (!trimmed) {
      return { ok: false, message: '命令不能为空' }
    }
    const child = this.processes.get(instanceId)
    if (!child || child.killed) {
      return { ok: false, message: '实例未运行，无法发送命令' }
    }
    if (!child.stdin?.writable) {
      return { ok: false, message: '当前实例未开放标准输入控制台' }
    }
    const payload = trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
    child.stdin.write(payload)
    this.appendSystem(instanceId, `> ${trimmed}`)
    return { ok: true }
  }

  private appendChunk(instanceId: string, stream: Exclude<ConsoleLogStream, 'system'>, chunk: Buffer | string) {
    const text = chunk.toString()
    if (!text) {
      return
    }
    const parts = text.split(/\r?\n/)
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (!part && i === parts.length - 1) {
        continue
      }
      if (part || i < parts.length - 1) {
        this.pushLine(instanceId, stream, part)
      }
    }
  }

  private appendSystem(instanceId: string, text: string) {
    this.pushLine(instanceId, 'system', text)
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

export const instanceRuntimeRegistry = new InstanceRuntimeRegistry()
