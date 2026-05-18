import type { ContainerCreateOptions } from 'dockerode'
import process from 'node:process'
import Docker from 'dockerode'
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

function mapPortBindings(ports: ShardContainerSpec['ports']) {
  if (!ports?.length) {
    return undefined
  }
  const bindings: NonNullable<ContainerCreateOptions['HostConfig']>['PortBindings'] = {}
  for (const port of ports) {
    const key = `${port.containerPort}/${port.protocol}`
    bindings[key] = [{ HostPort: String(port.hostPort) }]
  }
  return bindings
}

function resolveDockerOptions(dockerHost?: string) {
  const raw = dockerHost?.trim() || process.env.DOCKER_HOST?.trim() || 'unix:///var/run/docker.sock'
  if (raw.startsWith('unix://')) {
    return { socketPath: raw.replace(/^unix:\/\//, '') }
  }
  if (raw.startsWith('npipe://')) {
    return { socketPath: raw.replace(/^npipe:\/\//, '') }
  }
  return { host: raw }
}

export class DockerContainerRuntime implements ContainerRuntime {
  private readonly docker: Docker

  constructor(dockerHost?: string) {
    this.docker = new Docker(resolveDockerOptions(dockerHost))
  }

  async createShardContainer(spec: ShardContainerSpec): Promise<ContainerRef> {
    const existing = await this.findByName(spec.name)
    if (existing) {
      await this.remove(existing)
    }
    const containerGameRoot = spec.containerGameRoot ?? '/game'
    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Cmd: spec.cmd,
      WorkingDir: spec.workingDir,
      Env: spec.env
        ? Object.entries(spec.env).map(([key, value]) => `${key}=${value}`)
        : undefined,
      HostConfig: {
        Binds: [`${spec.hostInstallPath}:${containerGameRoot}`],
        PortBindings: mapPortBindings(spec.ports),
        RestartPolicy: { Name: 'no' },
      },
      Tty: false,
      OpenStdin: true,
      StdinOnce: false,
    })
    return { id: container.id, name: spec.name }
  }

  async start(ref: ContainerRef): Promise<void> {
    const container = this.docker.getContainer(ref.id)
    await container.start()
  }

  async stop(ref: ContainerRef, timeoutSec = 10): Promise<void> {
    const container = this.docker.getContainer(ref.id)
    try {
      await container.stop({ t: timeoutSec })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.toLowerCase().includes('not running')) {
        throw error
      }
    }
  }

  async remove(ref: ContainerRef): Promise<void> {
    const container = this.docker.getContainer(ref.id)
    try {
      await container.stop({ t: 5 })
    }
    catch {
      // already stopped
    }
    try {
      await container.remove({ force: true })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.toLowerCase().includes('no such container')) {
        throw error
      }
    }
  }

  async *logs(ref: ContainerRef, opts: LogOpts = {}): AsyncIterable<LogLine> {
    const container = this.docker.getContainer(ref.id)
    const baseOptions = {
      stdout: true,
      stderr: true,
      tail: opts.tail ?? 200,
      since: opts.since,
      timestamps: false,
    }
    if (!opts.follow) {
      const buffer = await container.logs({
        ...baseOptions,
        follow: false,
      })
      const text = buffer.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          yield { stream: 'stdout', text: line }
        }
      }
      return
    }
    const stream = await container.logs({
      ...baseOptions,
      follow: true,
    })
    const queue: LogLine[] = []
    let done = false
    let error: Error | undefined
    let notify: (() => void) | undefined
    const wake = () => {
      notify?.()
      notify = undefined
    }
    stream.on('data', (chunk: Buffer) => {
      const text = stripDockerLogFrame(chunk)
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          queue.push({ stream: 'stdout', text: line })
        }
      }
      wake()
    })
    stream.on('end', () => {
      done = true
      wake()
    })
    stream.on('error', (err: Error) => {
      error = err
      done = true
      wake()
    })
    while (!done || queue.length > 0) {
      if (error) {
        throw error
      }
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve
        })
        continue
      }
      yield queue.shift()!
    }
  }

  async exec(ref: ContainerRef, cmd: string[]): Promise<ExecResult> {
    const container = this.docker.getContainer(ref.id)
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    })
    const stream = await exec.start({ hijack: true, stdin: false })
    const output = await readDockerStream(stream)
    const inspect = await exec.inspect()
    return {
      exitCode: inspect.ExitCode ?? -1,
      output,
    }
  }

  async execStdin(ref: ContainerRef, input: string): Promise<ExecResult> {
    const payload = input.endsWith('\n') ? input : `${input}\n`
    const container = this.docker.getContainer(ref.id)
    const exec = await container.exec({
      Cmd: ['sh', '-c', 'cat > /proc/1/fd/0'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    })
    const stream = await exec.start({ hijack: true, stdin: true })
    stream.write(payload)
    stream.end()
    const output = await readDockerStream(stream)
    const inspect = await exec.inspect()
    return {
      exitCode: inspect.ExitCode ?? -1,
      output,
    }
  }

  async inspect(ref: ContainerRef): Promise<ContainerInspect> {
    const container = this.docker.getContainer(ref.id)
    const data = await container.inspect()
    const running = Boolean(data.State?.Running)
    return {
      id: data.Id,
      name: data.Name?.replace(/^\//, '') ?? ref.name,
      running,
      startedAt: data.State?.StartedAt,
    }
  }

  async stats(ref: ContainerRef): Promise<ContainerStats> {
    const container = this.docker.getContainer(ref.id)
    const stats = await container.stats({ stream: false }) as {
      cpu_stats?: { cpu_usage?: { total_usage?: number }, system_cpu_usage?: number, online_cpus?: number }
      precpu_stats?: { cpu_usage?: { total_usage?: number }, system_cpu_usage?: number }
      memory_stats?: { usage?: number }
    }
    const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0)
      - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0)
    const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0)
      - (stats.precpu_stats?.system_cpu_usage ?? 0)
    const onlineCpus = stats.cpu_stats?.online_cpus ?? 1
    const cpuUsageRate = systemDelta > 0
      ? Math.min(100, Math.max(0, (cpuDelta / systemDelta) * onlineCpus * 100))
      : null
    const memoryMb = stats.memory_stats?.usage
      ? Math.round(stats.memory_stats.usage / 1024 / 1024)
      : null
    return { cpuUsageRate, memoryMb }
  }

  async findByName(name: string): Promise<ContainerRef | undefined> {
    const containers = await this.docker.listContainers({ all: true, filters: { name: [name] } })
    const match = containers.find(item => item.Names?.some(n => n === `/${name}` || n.endsWith(`/${name}`)))
    if (!match?.Id) {
      return undefined
    }
    return { id: match.Id, name }
  }
}

function stripDockerLogFrame(chunk: Buffer): string {
  if (chunk.length <= 8) {
    return chunk.toString('utf8')
  }
  return chunk.subarray(8).toString('utf8')
}

async function readDockerStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return Buffer.concat(chunks).toString('utf8')
}
