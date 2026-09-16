export type ShardRole = 'master' | 'caves'

export interface ContainerRef {
  id: string
  name: string
}

export interface PortMapping {
  hostPort: number
  containerPort: number
  protocol: 'udp' | 'tcp'
}

export interface ShardContainerSpec {
  instanceId: string
  shard: ShardRole
  image: string
  name: string
  hostInstallPath: string
  containerGameRoot?: string
  hostBinds?: string[]
  /** 双容器分片互联用的 Docker 自定义网络名 */
  networkName?: string
  cmd: string[]
  workingDir: string
  env?: Record<string, string>
  ports?: PortMapping[]
}

export interface LogOpts {
  tail?: number
  follow?: boolean
  since?: number
  /** follow 模式下中止信号：abort 时立即销毁底层流，避免连接泄漏 */
  signal?: AbortSignal
}

export interface LogLine {
  stream: 'stdout' | 'stderr'
  text: string
  timestamp?: string
}

export interface ExecResult {
  exitCode: number
  output: string
}

export interface ContainerInspect {
  id: string
  name: string
  running: boolean
  pid?: number
  startedAt?: string
  /**
   * 进程已退出、运行时正在把它拉起来（Native 的 systemd `Restart=` 等待窗口）。
   * 此时 `running` 为 true —— 对上层而言实例仍算在运行中，否则状态会在运行/停止之间来回翻转。
   */
  restarting?: boolean
  /** 上一次退出的原因（Native 取 systemd 的 `Result`：exit-code / signal / oom-kill / timeout…） */
  exitResult?: string
  /** 累计重启次数（Native 取 systemd 的 `NRestarts`）；Docker 运行时不填 */
  restarts?: number
  /**
   * 探测本身失败（运行时不可达）：此时 `running: false` 只代表「问不到」，
   * 不代表实例真的停了。调用方据此保持现状，而不是把运行中的实例标成已停止。
   */
  probeFailed?: boolean
}

export interface ContainerStats {
  cpuUsageRate: number | null
  memoryMb: number | null
}

export interface ContainerRuntime {
  createShardContainer(spec: ShardContainerSpec): Promise<ContainerRef>
  ensureShardNetwork(instanceId: string): Promise<string>
  removeShardNetwork(instanceId: string): Promise<void>
  start(ref: ContainerRef): Promise<void>
  stop(ref: ContainerRef, timeoutSec?: number): Promise<void>
  remove(ref: ContainerRef): Promise<void>
  logs(ref: ContainerRef, opts?: LogOpts): AsyncIterable<LogLine>
  exec(ref: ContainerRef, cmd: string[]): Promise<ExecResult>
  execStdin(ref: ContainerRef, input: string): Promise<ExecResult>
  inspect(ref: ContainerRef): Promise<ContainerInspect>
  stats(ref: ContainerRef): Promise<ContainerStats>
  findByName(name: string): Promise<ContainerRef | undefined>
}
