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
