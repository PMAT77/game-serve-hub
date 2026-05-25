import type { FastifyInstance } from 'fastify'
import type { HostMemoryPressureFailure } from '../../infra/container/host-resource-guard'
import path from 'node:path'
import DockerClient from 'dockerode'
import { resolveDockerStatus } from '../../infra/docker'
import { resolveDockerConnectOptions } from '../../infra/docker-connect'
import {
  assessHostMemoryForHeavyOperation,
  ensureSteamcmdImage,
  formatGameDstImageError,
  getContainerRuntime,
  isSteamcmdImagePresent,
  pullGameDstImage,
} from '../../infra/container'
import { resolveInstanceContainerBind } from '../../infra/container/steamcmd-install-bind'
import { buildCavesContainerName, buildMasterContainerName } from '../../infra/container/naming'
import type { ContainerRef, ContainerRuntime, ShardContainerSpec } from '../../infra/container/types'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import {
  buildDstStartBlockedMessage,
  diagnoseDstInstallReadiness,
} from '../../infra/game-adapter/dst/install-readiness'
import { validateShardPortsForStart } from '../../infra/game-adapter/dst/port-conflict'
import {
  buildDstCavesShardContainerSpec,
  buildDstMasterShardContainerSpec,
} from '../../infra/game-adapter/dst/runtime-spec'
import { ensureDstCavesShardConfig } from '../../infra/game-adapter/dst/cluster-config'
import { ensureDockerShardInterconnectConfig } from '../../infra/game-adapter/dst/shard-network-config'
import {
  isCavesShardConfigured,
  readClusterShardEnabledFromInstall,
  readCavesServerIniFields,
  readMasterServerIniFields,
} from '../../infra/game-adapter/dst/shard-service'
import { getServerContainerConfig } from '../../shared/config/container'
import { instanceConsoleLogStore } from '../../shared/instance-runtime/console-log-store'
import { getGameInstanceById, updateGameInstanceRuntime } from '../../shared/db/index'

const logFollowAbortControllers = new Map<string, AbortController>()

export async function ensureContainerRuntimeReady(): Promise<{ ok: boolean, message?: string }> {
  if ((await resolveDockerStatus()) !== 'running') {
    return { ok: false, message: '无法连接 Docker，请确认面板已挂载 docker.sock（或 Windows 下 Docker Desktop 已启动）' }
  }
  const pullResult = await ensureSteamcmdImage()
  if (!pullResult.ok) {
    return {
      ok: false,
      message: `SteamCMD 镜像未就绪：${pullResult.error}。请检查网络或 panel.env 中的 GSH_STEAMCMD_IMAGE`,
    }
  }
  return { ok: true }
}

export function resolveDefaultInstanceInstallPath(instanceId: string): string {
  const { instancesRoot } = getServerContainerConfig()
  return path.join(instancesRoot, instanceId)
}

export async function resolveInstanceContainerRef(instanceId: string): Promise<ContainerRef | undefined> {
  const instance = await getGameInstanceById(instanceId)
  if (instance?.containerId) {
    return {
      id: instance.containerId,
      name: buildMasterContainerName(instanceId),
    }
  }
  const runtime = getContainerRuntime()
  return runtime.findByName(buildMasterContainerName(instanceId))
}

export async function resolveCavesContainerRef(instanceId: string): Promise<ContainerRef | undefined> {
  const runtime = getContainerRuntime()
  return runtime.findByName(buildCavesContainerName(instanceId))
}

export async function isInstanceContainerRunning(instanceId: string): Promise<boolean> {
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    return false
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  return inspect.running
}

function stopLogFollow(instanceId: string) {
  logFollowAbortControllers.get(instanceId)?.abort()
  logFollowAbortControllers.delete(instanceId)
}

export function startContainerLogFollow(instanceId: string, ref: ContainerRef) {
  stopLogFollow(instanceId)
  const controller = new AbortController()
  logFollowAbortControllers.set(instanceId, controller)
  instanceConsoleLogStore.appendSystem(instanceId, '已连接主世界容器，开始采集控制台输出')
  void (async () => {
    const runtime = getContainerRuntime()
    try {
      for await (const line of runtime.logs(ref, { follow: true, tail: 100 })) {
        if (controller.signal.aborted) {
          break
        }
        instanceConsoleLogStore.appendDockerLine(instanceId, line.text)
      }
    }
    catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        instanceConsoleLogStore.appendSystem(instanceId, `日志流中断: ${message}`)
      }
    }
  })()
}

async function readRecentContainerLogLines(runtime: ContainerRuntime, ref: ContainerRef, tail = 20): Promise<string[]> {
  const lines: string[] = []
  try {
    for await (const line of runtime.logs(ref, { tail })) {
      lines.push(line.text)
    }
  }
  catch {
    return []
  }
  return lines.slice(-tail)
}

async function readRecentContainerLogs(runtime: ContainerRuntime, ref: ContainerRef, tail = 20): Promise<string> {
  return readRecentContainerLogLines(runtime, ref, tail).then(rows => rows.join('\n').trim())
}

/** 读取主世界容器最近日志行（不依赖面板内存日志流，面板重启后仍可用） */
export async function readRecentInstanceContainerLogLines(instanceId: string, tail = 80): Promise<string[]> {
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    return []
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    return []
  }
  return readRecentContainerLogLines(runtime, ref, tail)
}

/** 面板重启后，为仍在运行的实例重新挂载 Docker 日志流 */
export async function ensureInstanceContainerLogFollow(instanceId: string): Promise<void> {
  if (logFollowAbortControllers.has(instanceId)) {
    return
  }
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    return
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    return
  }
  startContainerLogFollow(instanceId, ref)
}

async function startSingleShardContainer(
  runtime: ContainerRuntime,
  spec: ShardContainerSpec,
  gameDstImage: string,
): Promise<{ ok: true, ref: ContainerRef } | { ok: false, message: string }> {
  let ref: ContainerRef
  try {
    ref = await runtime.createShardContainer(spec)
  }
  catch (error) {
    const raw = error instanceof Error ? error.message : '创建分片容器失败'
    return { ok: false, message: formatGameDstImageError(raw, gameDstImage) }
  }
  try {
    await runtime.start(ref)
  }
  catch (error) {
    await runtime.remove(ref)
    const raw = error instanceof Error ? error.message : '分片容器启动失败'
    return { ok: false, message: formatGameDstImageError(raw, gameDstImage) }
  }
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    const logTail = await readRecentContainerLogs(runtime, ref)
    await runtime.remove(ref)
    const hint = logTail || '分片容器启动后立即退出，请检查安装目录与分片配置'
    return { ok: false, message: hint }
  }
  return { ok: true, ref }
}

async function stopAndRemoveShard(runtime: ContainerRuntime, ref: ContainerRef | undefined) {
  if (!ref) {
    return
  }
  try {
    await runtime.stop(ref, 15)
  }
  catch {
    // best-effort
  }
  try {
    await runtime.remove(ref)
  }
  catch {
    // best-effort
  }
}

export async function startInstanceContainer(
  app: FastifyInstance,
  input: {
    instanceId: string
    gameCode: string
    installPath: string
    instanceName: string
    gamePort: number | null
  },
): Promise<
  | { ok: true, ref: ContainerRef, displayCommand: string }
  | { ok: false, message: string, hostMemoryPressure?: HostMemoryPressureFailure }
> {
  if (input.gameCode.trim() !== DST_APP_ID) {
    return { ok: false, message: '当前仅支持饥荒（343050）容器化启动' }
  }
  const memoryPressure = assessHostMemoryForHeavyOperation('dst-container-start')
  if (!memoryPressure.ok) {
    return { ok: false, message: memoryPressure.detail, hostMemoryPressure: memoryPressure }
  }
  const { gameDstImage, instancesRoot, dockerHost } = getServerContainerConfig()
  const docker = new DockerClient(resolveDockerConnectOptions(dockerHost))
  const bindPlan = await resolveInstanceContainerBind(docker, input.installPath, instancesRoot)
  if (bindPlan.error) {
    return { ok: false, message: bindPlan.error }
  }
  const clusterInput = {
    instanceName: input.instanceName,
    gamePort: input.gamePort,
  }
  const masterSpec = buildDstMasterShardContainerSpec({
    instanceId: input.instanceId,
    hostInstallPath: input.installPath,
    image: gameDstImage,
    containerGameRoot: bindPlan.containerGameRoot,
    clusterInput,
  })
  if (!masterSpec) {
    const readiness = diagnoseDstInstallReadiness(input.installPath)
    const steamcmdImageReady = await isSteamcmdImagePresent()
    return {
      ok: false,
      message: buildDstStartBlockedMessage(readiness, steamcmdImageReady, {
        instanceStatus: 'error',
      }),
    }
  }
  const shardEnabled = readClusterShardEnabledFromInstall(input.installPath)
  if (shardEnabled && !isCavesShardConfigured(input.installPath)) {
    ensureDstCavesShardConfig(input.installPath, input.gamePort ?? undefined)
  }
  const cavesConfigured = shardEnabled && isCavesShardConfigured(input.installPath)
  if (shardEnabled && !cavesConfigured) {
    return { ok: false, message: '已开启洞穴分片但无法准备洞穴配置，请检查安装目录权限后重试' }
  }
  const masterFields = readMasterServerIniFields(input.installPath, input.gamePort)
  const cavesFields = shardEnabled && cavesConfigured
    ? readCavesServerIniFields(input.installPath)
    : null
  const portError = await validateShardPortsForStart(masterFields, cavesFields, {
    excludeInstanceId: input.instanceId,
    nodeId: 'local-node',
  })
  if (portError) {
    return { ok: false, message: portError }
  }
  let cavesSpec: ShardContainerSpec | undefined
  if (shardEnabled && cavesConfigured) {
    cavesSpec = buildDstCavesShardContainerSpec({
      instanceId: input.instanceId,
      hostInstallPath: input.installPath,
      image: gameDstImage,
      containerGameRoot: bindPlan.containerGameRoot,
      clusterInput,
    })
    if (!cavesSpec) {
      return { ok: false, message: '无法构建洞穴分片运行规格，请检查游戏文件是否完整' }
    }
  }
  app.log.info({ gameDstImage, bindMode: bindPlan.mode, hostBinds: bindPlan.hostBinds, shardEnabled }, '确保 DST 运行镜像可用')
  const imagePull = await pullGameDstImage()
  if (!imagePull.ok) {
    return { ok: false, message: imagePull.error }
  }
  masterSpec.hostBinds = bindPlan.hostBinds
  if (cavesSpec) {
    cavesSpec.hostBinds = bindPlan.hostBinds
  }
  const runtime = getContainerRuntime()
  let shardNetworkName: string | undefined
  if (shardEnabled && cavesConfigured) {
    if (ensureDockerShardInterconnectConfig(input.installPath, input.instanceId)) {
      instanceConsoleLogStore.appendSystem(
        input.instanceId,
        '已自动配置地上与洞穴互联地址',
      )
    }
    shardNetworkName = await runtime.ensureShardNetwork(input.instanceId)
    masterSpec.networkName = shardNetworkName
    if (cavesSpec) {
      cavesSpec.networkName = shardNetworkName
    }
  }
  const startedRefs: ContainerRef[] = []
  const startSpec = async (spec: ShardContainerSpec, label: string) => {
    const result = await startSingleShardContainer(runtime, spec, gameDstImage)
    if (!result.ok) {
      return { ok: false as const, message: `${label}：${result.message}` }
    }
    startedRefs.push(result.ref)
    return { ok: true as const, ref: result.ref }
  }
  const masterStart = await startSpec(masterSpec, '主世界')
  if (!masterStart.ok) {
    return { ok: false, message: masterStart.message }
  }
  if (cavesSpec) {
    const cavesStart = await startSpec(cavesSpec, '洞穴')
    if (!cavesStart.ok) {
      for (const ref of startedRefs) {
        await stopAndRemoveShard(runtime, ref)
      }
      return { ok: false, message: cavesStart.message }
    }
    instanceConsoleLogStore.appendSystem(input.instanceId, '洞穴分片容器已启动')
  }
  const ref = masterStart.ref
  const displayCommand = masterSpec.cmd.join(' ')
  app.log.info({
    instanceId: input.instanceId,
    containerId: ref.id,
    name: ref.name,
    command: displayCommand,
    shardEnabled,
  }, '实例容器已启动')
  startContainerLogFollow(input.instanceId, ref)
  return { ok: true, ref, displayCommand }
}

export async function stopInstanceContainer(instanceId: string): Promise<void> {
  stopLogFollow(instanceId)
  const instance = await getGameInstanceById(instanceId)
  const runtime = getContainerRuntime()
  const cavesRef = await resolveCavesContainerRef(instanceId)
  const masterRef = await resolveInstanceContainerRef(instanceId)
  if (cavesRef) {
    instanceConsoleLogStore.appendSystem(instanceId, '正在停止并移除洞穴容器以释放内存')
  }
  await stopAndRemoveShard(runtime, cavesRef)
  if (masterRef) {
    instanceConsoleLogStore.appendSystem(instanceId, '正在停止并移除主世界容器以释放内存')
  }
  await stopAndRemoveShard(runtime, masterRef)
  if (masterRef) {
    instanceConsoleLogStore.appendSystem(instanceId, '实例容器已删除')
  }
  await runtime.removeShardNetwork(instanceId)
  if (!masterRef && !cavesRef) {
    if (instance?.status === 'running') {
      await updateGameInstanceRuntime(instanceId, {
        status: 'stopped',
        containerId: null,
        runtimePid: null,
        runtimeStartedAt: null,
        lastError: null,
      })
    }
    return
  }
  await updateGameInstanceRuntime(instanceId, {
    status: 'stopped',
    containerId: null,
    runtimePid: null,
    runtimeStartedAt: null,
    lastError: null,
  })
}

export async function removeInstanceContainer(instanceId: string): Promise<void> {
  stopLogFollow(instanceId)
  const runtime = getContainerRuntime()
  const cavesRef = await resolveCavesContainerRef(instanceId)
  await stopAndRemoveShard(runtime, cavesRef)
  const masterRef = await resolveInstanceContainerRef(instanceId)
  if (masterRef) {
    await stopAndRemoveShard(runtime, masterRef)
    instanceConsoleLogStore.appendSystem(instanceId, '实例容器已删除')
  }
  await runtime.removeShardNetwork(instanceId)
}

export type ConsoleCommandShard = 'master' | 'caves'

const CONSOLE_SHARD_LABEL: Record<ConsoleCommandShard, string> = {
  master: '主世界',
  caves: '洞穴',
}

export async function isCavesContainerRunning(instanceId: string): Promise<boolean> {
  const ref = await resolveCavesContainerRef(instanceId)
  if (!ref) {
    return false
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  return inspect.running
}

async function resolveConsoleCommandContainerRef(
  instanceId: string,
  shard: ConsoleCommandShard,
): Promise<ContainerRef | undefined> {
  if (shard === 'caves') {
    return resolveCavesContainerRef(instanceId)
  }
  return resolveInstanceContainerRef(instanceId)
}

export async function sendInstanceContainerCommand(
  instanceId: string,
  command: string,
  shard: ConsoleCommandShard = 'master',
): Promise<{ ok: boolean, message?: string }> {
  const trimmed = command.trim()
  if (!trimmed) {
    return { ok: false, message: '命令不能为空' }
  }
  const ref = await resolveConsoleCommandContainerRef(instanceId, shard)
  const shardLabel = CONSOLE_SHARD_LABEL[shard]
  if (!ref) {
    return {
      ok: false,
      message: shard === 'caves' ? '洞穴分片未运行，无法发送命令' : '实例未运行，无法发送命令',
    }
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    return {
      ok: false,
      message: shard === 'caves' ? '洞穴分片未运行，无法发送命令' : '实例未运行，无法发送命令',
    }
  }
  const result = await runtime.execStdin(ref, trimmed)
  instanceConsoleLogStore.appendSystem(instanceId, `> [${shardLabel}] ${trimmed}`)
  if (result.exitCode !== 0) {
    return { ok: false, message: result.output || '命令发送失败' }
  }
  return { ok: true }
}
