import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveDstContainerResourceLimits } from './dst-container-resources'
import { sampleProcessMetrics } from '../../shared/instance-runtime/process-metrics'
import type {
  ContainerInspect,
  ContainerRef,
  ContainerRuntime,
  ContainerStats,
  ExecResult,
  LogLine,
  LogOpts,
  ShardContainerSpec,
} from './types'

const execFileAsync = promisify(execFile)
const SAFE_SERVICE_NAME = /^[A-Za-z0-9_.-]+$/

export interface NativeSystemdRuntimeOptions {
  runtimeDir: string
  unitDir: string
}

function assertSafeServiceName(name: string) {
  if (!SAFE_SERVICE_NAME.test(name)) {
    throw new Error(`非法 Native 服务名: ${name}`)
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function systemdQuote(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')}"`
}

function parseSystemctlProperties(stdout: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) {
      continue
    }
    result[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return result
}

function writeFileAtomic(filePath: string, content: string, mode: number) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode })
  fs.renameSync(temporaryPath, filePath)
  fs.chmodSync(filePath, mode)
}

export function buildNativeLauncherScript(spec: ShardContainerSpec, fifoPath: string): string {
  const command = spec.cmd.map(shellQuote).join(' ')
  return `#!/usr/bin/env bash
set -Eeuo pipefail

fifo_path=${shellQuote(fifoPath)}
rm -f -- "\${fifo_path}"
mkfifo -m 600 -- "\${fifo_path}"
exec 3<>"\${fifo_path}"
exec ${command} <&3
`
}

export function buildNativeSystemdUnit(spec: ShardContainerSpec, launcherPath: string): string {
  const limits = resolveDstContainerResourceLimits()
  const environment = Object.entries(spec.env ?? {})
    .map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`)
  const resourceLines: string[] = []
  if (limits?.memory) {
    resourceLines.push(`MemoryMax=${limits.memory}`)
  }
  if (limits?.nanoCpus) {
    resourceLines.push(`CPUQuota=${Math.max(1, limits.nanoCpus / 1e7).toFixed(2)}%`)
  }
  return `[Unit]
Description=Game Server Hub ${spec.instanceId} ${spec.shard}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(spec.workingDir)}
ExecStart=${systemdQuote(launcherPath)}
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=30
StandardOutput=journal
StandardError=journal
${environment.join('\n')}
${resourceLines.join('\n')}

[Install]
WantedBy=default.target
`
}

export class NativeSystemdRuntime implements ContainerRuntime {
  private readonly options: NativeSystemdRuntimeOptions

  constructor(options: NativeSystemdRuntimeOptions) {
    this.options = options
  }

  private unitName(refOrName: ContainerRef | string): string {
    const name = typeof refOrName === 'string' ? refOrName : refOrName.name
    assertSafeServiceName(name)
    return `${name}.service`
  }

  private servicePaths(name: string) {
    assertSafeServiceName(name)
    const serviceDir = path.resolve(this.options.runtimeDir, 'services', name)
    const servicesRoot = path.resolve(this.options.runtimeDir, 'services')
    if (serviceDir !== servicesRoot && !serviceDir.startsWith(`${servicesRoot}${path.sep}`)) {
      throw new Error(`Native 服务路径越界: ${name}`)
    }
    return {
      serviceDir,
      fifoPath: path.join(serviceDir, 'stdin.fifo'),
      launcherPath: path.join(serviceDir, 'launch.sh'),
      unitPath: path.join(this.options.unitDir, `${name}.service`),
    }
  }

  private async systemctl(args: string[]) {
    return execFileAsync('systemctl', ['--user', ...args], {
      timeout: 30_000,
      windowsHide: true,
    })
  }

  async ensureShardNetwork(instanceId: string): Promise<string> {
    return `native-${instanceId}`
  }

  async removeShardNetwork(): Promise<void> {
    // Native 分片在同一宿主机通过 loopback 通信，不需要独立网络对象。
  }

  async createShardContainer(spec: ShardContainerSpec): Promise<ContainerRef> {
    assertSafeServiceName(spec.name)
    if (!path.isAbsolute(spec.cmd[0] ?? '')) {
      throw new Error('Native 游戏可执行文件必须使用绝对路径')
    }
    const paths = this.servicePaths(spec.name)
    fs.mkdirSync(paths.serviceDir, { recursive: true, mode: 0o700 })
    fs.mkdirSync(this.options.unitDir, { recursive: true, mode: 0o700 })
    writeFileAtomic(paths.launcherPath, buildNativeLauncherScript(spec, paths.fifoPath), 0o700)
    writeFileAtomic(paths.unitPath, buildNativeSystemdUnit(spec, paths.launcherPath), 0o600)
    await this.systemctl(['daemon-reload'])
    return {
      id: this.unitName(spec.name),
      name: spec.name,
    }
  }

  async start(ref: ContainerRef): Promise<void> {
    await this.systemctl(['enable', '--now', this.unitName(ref)])
  }

  async stop(ref: ContainerRef, timeoutSec = 10): Promise<void> {
    try {
      await execFileAsync('systemctl', ['--user', 'stop', this.unitName(ref)], {
        timeout: Math.max(5, timeoutSec + 5) * 1000,
        windowsHide: true,
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/not loaded|not found/i.test(message)) {
        throw error
      }
    }
  }

  async remove(ref: ContainerRef): Promise<void> {
    await this.stop(ref)
    try {
      await this.systemctl(['disable', this.unitName(ref)])
    }
    catch {
      // Unit 可能尚未启用或已被手工清理。
    }
    const paths = this.servicePaths(ref.name)
    for (const filePath of [paths.unitPath, paths.fifoPath, paths.launcherPath]) {
      try {
        fs.unlinkSync(filePath)
      }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') {
          throw error
        }
      }
    }
    try {
      fs.rmdirSync(paths.serviceDir)
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
        throw error
      }
    }
    await this.systemctl(['daemon-reload'])
  }

  async *logs(ref: ContainerRef, opts: LogOpts = {}): AsyncIterable<LogLine> {
    const args = [
      `--user-unit=${this.unitName(ref)}`,
      '--output=cat',
      '--no-pager',
      '--quiet',
      '--lines',
      String(opts.tail ?? 200),
    ]
    if (!opts.follow) {
      try {
        const { stdout } = await execFileAsync('journalctl', args, {
          timeout: 15_000,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        })
        for (const line of stdout.split(/\r?\n/)) {
          if (line.trim()) {
            yield { stream: 'stdout', text: line }
          }
        }
      }
      catch {
        return
      }
      return
    }

    const child = spawn('journalctl', [...args, '--follow'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const queue: LogLine[] = []
    let stdoutCarry = ''
    let stderrCarry = ''
    let done = false
    let failure: Error | undefined
    let notify: (() => void) | undefined
    const wake = () => {
      notify?.()
      notify = undefined
    }
    const consume = (stream: 'stdout' | 'stderr', text: string) => {
      const previous = stream === 'stdout' ? stdoutCarry : stderrCarry
      const parts = `${previous}${text}`.split(/\r?\n/)
      const carry = parts.pop() ?? ''
      if (stream === 'stdout') {
        stdoutCarry = carry
      }
      else {
        stderrCarry = carry
      }
      for (const line of parts) {
        if (line.trim()) {
          queue.push({ stream, text: line })
        }
      }
      wake()
    }
    child.stdout.on('data', chunk => consume('stdout', String(chunk)))
    child.stderr.on('data', chunk => consume('stderr', String(chunk)))
    child.once('error', (error) => {
      failure = error
      done = true
      wake()
    })
    child.once('exit', () => {
      done = true
      wake()
    })
    try {
      while (!done || queue.length > 0) {
        if (failure) {
          throw failure
        }
        const line = queue.shift()
        if (line) {
          yield line
          continue
        }
        await new Promise<void>((resolve) => {
          notify = resolve
        })
      }
    }
    finally {
      child.kill('SIGTERM')
    }
  }

  async exec(): Promise<ExecResult> {
    return {
      exitCode: 1,
      output: 'Native systemd 运行时不支持在游戏进程中执行独立命令',
    }
  }

  async execStdin(ref: ContainerRef, input: string): Promise<ExecResult> {
    const inspect = await this.inspect(ref)
    if (!inspect.running) {
      return { exitCode: 1, output: '实例未运行' }
    }
    const { fifoPath } = this.servicePaths(ref.name)
    let descriptor: number | undefined
    try {
      descriptor = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)
      fs.writeSync(descriptor, input.endsWith('\n') ? input : `${input}\n`, undefined, 'utf8')
      return { exitCode: 0, output: '' }
    }
    catch (error) {
      return {
        exitCode: 1,
        output: error instanceof Error ? error.message : '无法写入 Native 控制台管道',
      }
    }
    finally {
      if (descriptor !== undefined) {
        fs.closeSync(descriptor)
      }
    }
  }

  async inspect(ref: ContainerRef): Promise<ContainerInspect> {
    try {
      const { stdout } = await this.systemctl([
        'show',
        this.unitName(ref),
        '--property=LoadState,ActiveState,MainPID,ExecMainStartTimestamp',
      ])
      const properties = parseSystemctlProperties(stdout)
      const running = properties.LoadState !== 'not-found' && properties.ActiveState === 'active'
      const pid = Number(properties.MainPID)
      return {
        id: this.unitName(ref),
        name: ref.name,
        running,
        ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}),
        ...(properties.ExecMainStartTimestamp ? { startedAt: properties.ExecMainStartTimestamp } : {}),
      }
    }
    catch {
      return {
        id: this.unitName(ref),
        name: ref.name,
        running: false,
      }
    }
  }

  async stats(ref: ContainerRef): Promise<ContainerStats> {
    const inspect = await this.inspect(ref)
    if (!inspect.running || !inspect.pid) {
      return { cpuUsageRate: null, memoryMb: null }
    }
    try {
      const usage = await sampleProcessMetrics(inspect.pid)
      if (!usage) {
        return { cpuUsageRate: null, memoryMb: null }
      }
      return {
        cpuUsageRate: usage.cpuUsageRate,
        memoryMb: usage.memoryMb,
      }
    }
    catch {
      return { cpuUsageRate: null, memoryMb: null }
    }
  }

  async findByName(name: string): Promise<ContainerRef | undefined> {
    assertSafeServiceName(name)
    const paths = this.servicePaths(name)
    if (!fs.existsSync(paths.unitPath)) {
      return undefined
    }
    return {
      id: this.unitName(name),
      name,
    }
  }
}
