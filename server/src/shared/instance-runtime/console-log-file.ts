import fs from 'node:fs'
import path from 'node:path'
import type { ConsoleLogLine, ConsoleLogSink } from './console-log-store'

/** 单个日志文件上限：超过就轮转，避免长期运行的服把磁盘写满 */
export const CONSOLE_LOG_MAX_BYTES = 5 * 1024 * 1024

/** 保留的文件数量（当前文件 + 2 个历史文件） */
export const CONSOLE_LOG_KEEP_FILES = 3

/** 读取历史日志时最多返回的行数 */
export const CONSOLE_LOG_TAIL_LINES = 500

/**
 * 控制台日志目录：与安装日志同处数据目录下的 install-logs，
 * Docker 模式下随数据卷一起持久化，Native 模式下就在 /var/lib 下。
 */
export function resolveConsoleLogsDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'install-logs', 'console')
}

/** 实例 ID 会被拼进文件名，先剔除路径分隔符等字符 */
function sanitizeInstanceId(instanceId: string): string {
  return instanceId.replace(/[^A-Za-z0-9_.-]/g, '_')
}

export function resolveConsoleLogFilePath(consoleLogsDir: string, instanceId: string): string {
  return path.join(consoleLogsDir, `${sanitizeInstanceId(instanceId)}.log`)
}

export function formatConsoleLogLine(line: Pick<ConsoleLogLine, 'at' | 'stream' | 'text' | 'shard'>): string {
  const shard = line.shard ? `[${line.shard}] ` : ''
  const source = line.stream === 'system' ? '[panel] ' : ''
  return `${line.at} ${shard}${source}${line.text}`
}

/**
 * 把控制台日志追加到磁盘。
 *
 * 写入失败只吞掉不抛：日志落盘属于可观测性，磁盘满、权限不对都不该影响面板主流程，
 * 更不该让正在跑的游戏受牵连。
 */
export class InstanceConsoleLogFile implements ConsoleLogSink {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  append(instanceId: string, line: ConsoleLogLine): void {
    try {
      const filePath = resolveConsoleLogFilePath(this.dir, instanceId)
      const text = `${formatConsoleLogLine(line)}\n`
      this.rotateIfNeeded(filePath, Buffer.byteLength(text, 'utf8'))
      fs.appendFileSync(filePath, text, 'utf8')
    }
    catch {
      // 忽略：见类注释
    }
  }

  remove(instanceId: string): void {
    try {
      const filePath = resolveConsoleLogFilePath(this.dir, instanceId)
      for (let index = 0; index < CONSOLE_LOG_KEEP_FILES; index += 1) {
        const target = index === 0 ? filePath : `${filePath}.${index}`
        fs.rmSync(target, { force: true })
      }
    }
    catch {
      // 忽略：见类注释
    }
  }

  /** 读取当前文件末尾若干行；文件不存在时返回 null */
  readTail(instanceId: string, limit = CONSOLE_LOG_TAIL_LINES): string | null {
    const filePath = resolveConsoleLogFilePath(this.dir, instanceId)
    if (!fs.existsSync(filePath)) {
      return null
    }
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(line => line.length > 0)
    return lines.slice(Math.max(0, lines.length - limit)).join('\n')
  }

  resolveFilePath(instanceId: string): string {
    return resolveConsoleLogFilePath(this.dir, instanceId)
  }

  /** 当前文件装不下这一行时轮转：删最旧的，其余依次改名 */
  private rotateIfNeeded(filePath: string, incomingBytes: number): void {
    if (!fs.existsSync(filePath)) {
      return
    }
    const size = fs.statSync(filePath).size
    if (size + incomingBytes <= CONSOLE_LOG_MAX_BYTES) {
      return
    }
    const oldest = `${filePath}.${CONSOLE_LOG_KEEP_FILES - 1}`
    fs.rmSync(oldest, { force: true })
    for (let index = CONSOLE_LOG_KEEP_FILES - 2; index >= 1; index -= 1) {
      const from = `${filePath}.${index}`
      const to = `${filePath}.${index + 1}`
      if (fs.existsSync(from)) {
        fs.renameSync(from, to)
      }
    }
    fs.renameSync(filePath, `${filePath}.1`)
  }
}

let activeConsoleLogFile: InstanceConsoleLogFile | null = null

/** 由启动流程注入；路由通过它读取与下载日志，未注入时按「无日志」处理 */
export function setActiveConsoleLogFile(file: InstanceConsoleLogFile | null): void {
  activeConsoleLogFile = file
}

export function getActiveConsoleLogFile(): InstanceConsoleLogFile | null {
  return activeConsoleLogFile
}
