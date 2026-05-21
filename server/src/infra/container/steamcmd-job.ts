import type Docker from 'dockerode'
import DockerClient from 'dockerode'
import { resolveDockerConnectOptions } from '../docker-connect'
import { getServerContainerConfig } from '../../shared/config/container'
import { buildSteamcmdContainerEnv, loadSteamcmdRuntimeConfig } from '../../shared/config/steamcmd'
import { decodeDockerMultiplexLogChunk } from './docker-log'
import { sanitizeSteamcmdLogLine } from './steamcmd-errors'
import { resolveSteamcmdContainerMemoryLimits } from './steamcmd-container-resources'

export const STEAMCMD_LABEL_MANAGED = 'gsh.managed'
export const STEAMCMD_LABEL_MANAGED_VALUE = 'steamcmd-install'
export const STEAMCMD_LABEL_JOB = 'gsh.steamcmd.job'
export const STEAMCMD_LABEL_KIND = 'gsh.steamcmd.kind'

const activeSteamcmdInstallContainers = new Map<string, Docker.Container>()
const cancelledSteamcmdInstallKeys = new Set<string>()

function resolveDocker(): Docker {
  const { dockerHost } = getServerContainerConfig()
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

function isDockerContainerNotRunningError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return normalized.includes('not running')
    || normalized.includes('is not running')
    || normalized.includes('already stopped')
}

async function safeKillContainer(container: Docker.Container): Promise<void> {
  try {
    const inspect = await container.inspect()
    if (!inspect.State.Running) {
      return
    }
    await container.kill()
  }
  catch (error) {
    if (!isDockerContainerNotRunningError(error)) {
      throw error
    }
  }
}

export async function forceRemoveSteamcmdContainer(container: Docker.Container): Promise<void> {
  try {
    await safeKillContainer(container)
  }
  catch {
    // ignore cleanup errors
  }
  try {
    await container.remove({ force: true })
  }
  catch {
    // already removed
  }
}

function buildSteamcmdInstallContainerName(jobId?: string): string | undefined {
  if (!jobId?.trim()) {
    return undefined
  }
  const safeId = jobId.trim().replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 20)
  const suffix = Date.now().toString(36).slice(-6)
  return `gsh-steamcmd-${safeId || 'job'}-${suffix}`
}

/** 仅清理指定 job 的已停止 SteamCMD 任务容器（不扫全局镜像） */
export async function cleanupOrphanedSteamcmdInstallContainers(jobId?: string): Promise<number> {
  if (!jobId?.trim()) {
    return 0
  }
  try {
    const docker = resolveDocker()
    const byLabel = await docker.listContainers({
      all: true,
      filters: {
        label: [
          `${STEAMCMD_LABEL_MANAGED}=${STEAMCMD_LABEL_MANAGED_VALUE}`,
          `${STEAMCMD_LABEL_JOB}=${jobId.trim()}`,
        ],
      },
    })
    let removed = 0
    for (const item of byLabel) {
      if (item.State === 'running') {
        continue
      }
      try {
        await forceRemoveSteamcmdContainer(docker.getContainer(item.Id))
        removed += 1
      }
      catch {
        // best-effort
      }
    }
    return removed
  }
  catch {
    return 0
  }
}

/** 清理已停止的 app_info 一次性容器 */
export async function cleanupStoppedSteamcmdAppInfoContainers(): Promise<number> {
  try {
    const docker = resolveDocker()
    const byLabel = await docker.listContainers({
      all: true,
      filters: {
        label: [
          `${STEAMCMD_LABEL_MANAGED}=${STEAMCMD_LABEL_MANAGED_VALUE}`,
          `${STEAMCMD_LABEL_KIND}=app-info`,
        ],
      },
    })
    let removed = 0
    for (const item of byLabel) {
      if (item.State === 'running') {
        continue
      }
      try {
        await forceRemoveSteamcmdContainer(docker.getContainer(item.Id))
        removed += 1
      }
      catch {
        // best-effort
      }
    }
    return removed
  }
  catch {
    return 0
  }
}

export async function isSteamcmdJobRunning(jobId: string): Promise<boolean> {
  if (!jobId.trim()) {
    return false
  }
  try {
    const docker = resolveDocker()
    const containers = await docker.listContainers({
      filters: {
        label: [
          `${STEAMCMD_LABEL_MANAGED}=${STEAMCMD_LABEL_MANAGED_VALUE}`,
          `${STEAMCMD_LABEL_JOB}=${jobId.trim()}`,
        ],
      },
    })
    return containers.some(item => item.State === 'running')
  }
  catch {
    return false
  }
}

export function clearSteamcmdJobCancelFlag(jobId: string): void {
  cancelledSteamcmdInstallKeys.delete(jobId)
}

export async function cancelSteamcmdInstallContainer(cancelKey: string): Promise<void> {
  cancelledSteamcmdInstallKeys.add(cancelKey)
  try {
    const tracked = activeSteamcmdInstallContainers.get(cancelKey)
    if (tracked) {
      await forceRemoveSteamcmdContainer(tracked)
      activeSteamcmdInstallContainers.delete(cancelKey)
    }
    await cleanupOrphanedSteamcmdInstallContainers(cancelKey)
  }
  catch {
    // cleanup best-effort; must not crash panel
  }
}

export interface SteamcmdJobSpec {
  image: string
  cmd: string[]
  hostBinds?: string[]
  /** 与 install-path 中 chown 的 steam(1000) 一致；root 镜像若以 root 跑易出现 Missing file permissions */
  user?: string
  jobId?: string
  kind?: 'app-update' | 'app-info'
  timeoutMs: number
  onLogLine?: (line: string) => void
}

export interface SteamcmdJobResult {
  ok: boolean
  exitCode: number
  output: string
  cancelled?: boolean
  timedOut?: boolean
}

async function followContainerLogs(
  container: Docker.Container,
  pushLine: (line: string) => void,
): Promise<void> {
  const stream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: false,
  })
  let buffer = ''
  let frameCarry: Buffer = Buffer.alloc(0)
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      const decoded = decodeDockerMultiplexLogChunk(frameCarry, chunk)
      frameCarry = decoded.carry
      buffer += decoded.text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const text = line.trim()
        if (text) {
          pushLine(text)
        }
      }
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  const tail = buffer.trim()
  if (tail) {
    pushLine(tail)
  }
}

export async function runSteamcmdJob(spec: SteamcmdJobSpec): Promise<SteamcmdJobResult> {
  const docker = resolveDocker()
  const logLines: string[] = []
  const pushLine = (line: string) => {
    const text = sanitizeSteamcmdLogLine(line)
    if (!text) {
      return
    }
    logLines.push(text)
    if (logLines.length > 80) {
      logLines.shift()
    }
    spec.onLogLine?.(text)
  }

  const jobId = spec.jobId?.trim()
  const kind = spec.kind ?? 'app-update'

  if (jobId) {
    clearSteamcmdJobCancelFlag(jobId)
    await cleanupOrphanedSteamcmdInstallContainers(jobId)
  }
  else if (kind === 'app-info') {
    await cleanupStoppedSteamcmdAppInfoContainers()
  }

  const labels: Record<string, string> = {
    [STEAMCMD_LABEL_MANAGED]: STEAMCMD_LABEL_MANAGED_VALUE,
    [STEAMCMD_LABEL_KIND]: kind,
  }
  if (jobId) {
    labels[STEAMCMD_LABEL_JOB] = jobId
  }

  const memoryLimits = resolveSteamcmdContainerMemoryLimits(
    spec.kind === 'app-info' ? 'app-info' : 'app-update',
  )
  const steamcmdConfig = loadSteamcmdRuntimeConfig()
  const hostConfig: NonNullable<Docker.ContainerCreateOptions['HostConfig']> = {
    Binds: spec.hostBinds,
    AutoRemove: true,
    Ulimits: [{ Name: 'nofile', Soft: 65536, Hard: 65536 }],
    ...(memoryLimits
      ? { Memory: memoryLimits.Memory, MemorySwap: memoryLimits.MemorySwap }
      : {}),
    ...(steamcmdConfig.networkMode === 'host' ? { NetworkMode: 'host' } : {}),
  }

  const containerEnv = buildSteamcmdContainerEnv(steamcmdConfig)

  const container = await docker.createContainer({
    name: buildSteamcmdInstallContainerName(jobId),
    Image: spec.image,
    Cmd: spec.cmd,
    User: spec.user,
    Env: containerEnv.length > 0 ? containerEnv : undefined,
    Labels: labels,
    HostConfig: hostConfig,
    AttachStdout: true,
    AttachStderr: true,
  })

  if (jobId) {
    activeSteamcmdInstallContainers.set(jobId, container)
  }

  try {
    await container.start()
  }
  catch (error) {
    await forceRemoveSteamcmdContainer(container)
    if (jobId) {
      activeSteamcmdInstallContainers.delete(jobId)
    }
    const message = error instanceof Error ? error.message : String(error)
    pushLine(`SteamCMD 容器启动失败: ${message}`)
    return {
      ok: false,
      exitCode: -1,
      output: logLines.slice(-20).join('\n') || `SteamCMD 容器启动失败: ${message}`,
    }
  }

  pushLine('SteamCMD 容器已启动')

  let exitCode = -1
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    void safeKillContainer(container).catch(() => {})
  }, spec.timeoutMs)

  try {
    const waitPromise = container.wait().then(result => result.StatusCode ?? -1)
    const logsPromise = followContainerLogs(container, pushLine)
    const [code] = await Promise.all([waitPromise, logsPromise])
    exitCode = code
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushLine(`SteamCMD 任务异常: ${message}`)
  }
  finally {
    clearTimeout(timeout)
    if (jobId) {
      activeSteamcmdInstallContainers.delete(jobId)
    }
    await forceRemoveSteamcmdContainer(container)
    if (jobId) {
      await cleanupOrphanedSteamcmdInstallContainers(jobId)
    }
    else if (kind === 'app-info') {
      await cleanupStoppedSteamcmdAppInfoContainers()
    }
  }

  const wasCancelled = Boolean(jobId && cancelledSteamcmdInstallKeys.has(jobId))
  if (wasCancelled && jobId) {
    cancelledSteamcmdInstallKeys.delete(jobId)
  }

  const output = logLines.slice(-20).join('\n')
    || (timedOut ? 'SteamCMD 任务超时' : wasCancelled ? 'SteamCMD 任务已取消' : 'SteamCMD 任务执行失败')

  return {
    ok: exitCode === 0 && !timedOut && !wasCancelled,
    exitCode,
    output,
    cancelled: wasCancelled,
    timedOut,
  }
}
