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
/**
 * unit 的停机预算：DST 收到 SIGTERM 后需要落盘存档，大洞穴存档常见数十秒。
 * 与之配套的客户端等待上限必须严格大于该值，否则 systemd 还在收尾就被判失败。
 */
const NATIVE_UNIT_STOP_TIMEOUT_SEC = 30
const NATIVE_STOP_CLIENT_TIMEOUT_MS = (NATIVE_UNIT_STOP_TIMEOUT_SEC + 15) * 1000
/** 打开文件数上限：多 Mod 大存档下用户级 systemd 默认值偏小，与容器模式对齐 */
const NATIVE_UNIT_NOFILE_LIMIT = 65_535
/** CPUQuota 只接受 1%–10000%：越界会让 systemd 判定整个 unit 非法，宁可钳到边界 */
const NATIVE_UNIT_CPU_QUOTA_MAX_PERCENT = 10_000
/** MemoryMax 低于 1 MiB 是非法值，钳到 1 MiB 而不是写出一个起不来的 unit */
const NATIVE_UNIT_MEMORY_MIN_BYTES = 1024 * 1024
/** 启动失败时回给界面的诊断文本上限，避免整份 unit 加 status 输出刷屏 */
const UNIT_DIAGNOSTIC_MAX_CHARS = 2_000

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

/**
 * systemd 会对手写的值做 specifier 展开：路径或描述里出现一个裸 `%`（如实例目录名带 `%`）
 * 会让整个 unit 被判成非法，`systemctl start` 只报一句 "has a bad unit file setting"。
 * `%%` 才是字面 `%`，因此所有来自实例数据的值先过这里。
 */
function escapeSpecifiers(value: string): string {
  return value.replace(/%/g, '%%')
}

function systemdQuote(value: string): string {
  return `"${escapeSpecifiers(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')}"`
}

/**
 * WorkingDirectory= 不能加引号：systemd 对这一行不做去引号处理，会把 `"/srv/x/bin64"`
 * 整串（引号在内）当路径来判断绝对性，于是报 "path is not absolute" 并把 unit 判成
 * bad unit file setting —— 实例一个都起不来。ExecStart= 走 shell 风格分词，引号是合法的，
 * 因此两者必须分开处理；路径里的 `%` 仍要转义（specifier 展开对两行都生效）。
 */
function systemdPath(value: string): string {
  return escapeSpecifiers(value)
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

export interface UnitLoadDiagnosticInput {
  unitPath: string
  unitContent?: string
  verifyOutput?: string
  statusOutput?: string
}

/** unit 与 status 输出都很长，界面只需要看清哪一行非法 */
function truncateDiagnostic(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > UNIT_DIAGNOSTIC_MAX_CHARS
    ? `${trimmed.slice(0, UNIT_DIAGNOSTIC_MAX_CHARS)}\n…（已截断）`
    : trimmed
}

/**
 * systemd 的 `has a bad unit file setting` 不说是哪一行：这里把自校验输出、status 原文与
 * unit 文件内容一起带上，界面与日志直接给出可定位的证据，省掉一次服务器登录排查。
 */
export function formatUnitLoadDiagnostic(input: UnitLoadDiagnosticInput): string {
  const sections: string[] = []
  if (input.verifyOutput?.trim()) {
    sections.push(`systemd-analyze verify：\n${truncateDiagnostic(input.verifyOutput)}`)
  }
  if (input.statusOutput?.trim()) {
    sections.push(`systemctl --user status：\n${truncateDiagnostic(input.statusOutput)}`)
  }
  if (input.unitContent?.trim()) {
    sections.push(`unit 文件内容（${input.unitPath}）：\n${truncateDiagnostic(input.unitContent)}`)
  }
  return sections.join('\n\n')
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
    resourceLines.push(`MemoryMax=${Math.max(limits.memory, NATIVE_UNIT_MEMORY_MIN_BYTES)}`)
  }
  if (limits?.nanoCpus) {
    const quotaPercent = Math.min(NATIVE_UNIT_CPU_QUOTA_MAX_PERCENT, Math.max(1, limits.nanoCpus / 1e7))
    resourceLines.push(`CPUQuota=${quotaPercent.toFixed(2)}%`)
  }
  /**
   * 不写 After=/Wants=network-online.target：分片跑在用户级 systemd 里，用户实例没有这个
   * target（依赖只会是 not-found 噪音），DST 分片本身也不需要等网络在线。
   */
  return `[Unit]
Description=Game Server Hub ${escapeSpecifiers(spec.instanceId)} ${spec.shard}

[Service]
Type=simple
WorkingDirectory=${systemdPath(spec.workingDir)}
ExecStart=${systemdQuote(launcherPath)}
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=${NATIVE_UNIT_STOP_TIMEOUT_SEC}
LimitNOFILE=${NATIVE_UNIT_NOFILE_LIMIT}
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
  /** unit 路径 → systemd-analyze verify 的输出，仅用于启动失败时的诊断 */
  private readonly unitVerifyOutput = new Map<string, string>()

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

  /** 跑命令并尽量取回输出：systemd-analyze/systemctl 判失败时原因都在 stdout/stderr 里 */
  private async captureOutput(command: string, args: string[], timeoutMs: number): Promise<string | undefined> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: timeoutMs,
        windowsHide: true,
      })
      return `${stdout}${stderr}`.trim() || undefined
    }
    catch (error) {
      const partial = error as { stdout?: string, stderr?: string }
      return `${partial.stdout ?? ''}${partial.stderr ?? ''}`.trim() || undefined
    }
  }

  /**
   * 写完 unit 立刻让 systemd 自己校验一次。命令缺失或返回非零都不阻断启动
   * （依赖类 warning 也会返回非零），输出只在启动失败时作为诊断证据给出。
   */
  private async recordUnitVerify(unitPath: string): Promise<void> {
    const output = await this.captureOutput('systemd-analyze', ['verify', unitPath], 15_000)
    if (output) {
      this.unitVerifyOutput.set(unitPath, output)
    }
  }

  private async describeStartFailure(ref: ContainerRef, error: unknown): Promise<string> {
    const message = error instanceof Error ? error.message : String(error)
    const paths = this.servicePaths(ref.name)
    let unitContent: string | undefined
    try {
      unitContent = fs.readFileSync(paths.unitPath, 'utf8')
    }
    catch {
      unitContent = undefined
    }
    const statusOutput = await this.captureOutput(
      'systemctl',
      ['--user', 'status', this.unitName(ref), '--no-pager', '-l'],
      15_000,
    )
    const verifyOutput = this.unitVerifyOutput.get(paths.unitPath)
    const diagnostic = formatUnitLoadDiagnostic({
      unitPath: paths.unitPath,
      ...(unitContent ? { unitContent } : {}),
      ...(verifyOutput ? { verifyOutput } : {}),
      ...(statusOutput ? { statusOutput } : {}),
    })
    return diagnostic ? `${message}\n\n${diagnostic}` : message
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
    await this.recordUnitVerify(paths.unitPath)
    await this.systemctl(['daemon-reload'])
    return {
      id: this.unitName(spec.name),
      name: spec.name,
    }
  }

  async start(ref: ContainerRef): Promise<void> {
    try {
      await this.systemctl(['enable', '--now', this.unitName(ref)])
    }
    catch (error) {
      // systemd 的 "bad unit file setting" 不指出具体哪一行：这里补上 unit 原文与自校验输出
      throw new Error(await this.describeStartFailure(ref, error))
    }
  }

  async stop(ref: ContainerRef, timeoutSec = 10): Promise<void> {
    // 等待上限取「调用方预算 + 5 秒」与「unit 停机预算 + 15 秒」的较大者：
    // 后者保证 systemd 有完整时间收尾，不会在存档落盘途中被判成失败。
    const clientTimeoutMs = Math.max(((timeoutSec ?? 10) + 5) * 1000, NATIVE_STOP_CLIENT_TIMEOUT_MS)
    try {
      await execFileAsync('systemctl', ['--user', 'stop', this.unitName(ref)], {
        timeout: clientTimeoutMs,
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
    // 停止失败不能中断清理：单元若仍处于 enabled，宿主重启时该分片会被 systemd 自动拉起，
    // 与「实例已停止/已删除」的状态完全相反。这里先记下错误，做完清理再抛出。
    let stopError: unknown
    try {
      await this.stop(ref)
    }
    catch (error) {
      stopError = error
    }
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
    this.unitVerifyOutput.delete(paths.unitPath)
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
    if (stopError) {
      throw stopError
    }
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
    // 与 Docker 运行时对齐：消费方 abort 后立即结束循环并回收 journalctl 子进程。
    // 缺了这段，实例无日志输出时 journalctl --follow 会永久挂起，每次开停泄漏一个进程。
    if (opts.signal) {
      const signal = opts.signal
      const abort = () => {
        done = true
        wake()
      }
      if (signal.aborted) {
        abort()
      }
      else {
        signal.addEventListener('abort', abort, { once: true })
      }
    }
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
