import type { FastifyInstance } from 'fastify'
import type { HostMemoryPressureFailure } from '../../infra/container/host-resource-guard'
import path from 'node:path'
import { resolveDockerStatus } from '../../infra/docker'
import { createDockerClient } from '../../infra/docker-connect'
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
import type { ContainerInspect, ContainerRef, ContainerRuntime, ShardContainerSpec } from '../../infra/container/types'
import { DST_APP_ID, DST_CLUSTER_NAME, DST_CONF_DIR, DST_STORAGE_DIR } from '../../infra/game-adapter/dst/constants'
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
import { syncInstanceModFilesFromDb } from '../mod/mod-file-sync-service'
import { collectReservedDstPortsOnNode } from './dst-port-service'
import { LOCAL_NODE_ID } from '../../shared/dst/local-dst-instance'
import {
  ensureDockerShardInterconnectConfig,
  ensureNativeShardInterconnectConfig,
} from '../../infra/game-adapter/dst/shard-network-config'
import {
  isCavesShardConfigured,
  readClusterShardEnabledFromInstall,
  readCavesServerIniFields,
  readMasterServerIniFields,
} from '../../infra/game-adapter/dst/shard-service'
import { getServerContainerConfig } from '../../shared/config/container'
import { isSteamcmdRuntimeReady, resolveRuntimeStatus } from '../../infra/runtime'
import { instanceConsoleLogStore } from '../../shared/instance-runtime/console-log-store'
import { getGameInstanceById, updateGameInstanceRuntime } from '../../shared/db/index'

export type ConsoleCommandShard = 'master' | 'caves'

const CONSOLE_SHARD_LABEL: Record<ConsoleCommandShard, string> = {
  master: '地上',
  caves: '洞穴',
}

const logFollowAbortControllers = new Map<string, AbortController>()

function logFollowKey(instanceId: string, shard: ConsoleCommandShard) {
  return `${instanceId}:${shard}`
}

export async function ensureContainerRuntimeReady(): Promise<{ ok: boolean, message?: string }> {
  const { runtimeMode } = getServerContainerConfig()
  if (runtimeMode === 'native') {
    if ((await resolveRuntimeStatus()) !== 'running') {
      return { ok: false, message: '无法连接 systemd 用户服务管理器，请确认 gsh 用户已启用 linger 且 user bus 正常' }
    }
    if (!(await isSteamcmdRuntimeReady())) {
      return { ok: false, message: 'SteamCMD 未就绪，请检查 GSH_NATIVE_STEAMCMD_PATH 或重新运行 Native 安装器' }
    }
    return { ok: true }
  }
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

export async function isInstanceContainerRunning(
  instanceId: string,
  shard: ConsoleCommandShard = 'master',
): Promise<boolean> {
  const ref = await resolveConsoleCommandContainerRef(instanceId, shard)
  if (!ref) {
    return false
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  return inspect.running
}

export interface InstanceShardRuntimeProbe {
  /** 该分片是否存在运行时单元（从未创建或已被移除时为 false） */
  unitExists: boolean
  /** 运行时快照；运行时不可达时为 null（此时不能据此判定已停止） */
  snapshot: ContainerInspect | null
}

/**
 * 分片运行时快照：状态对账用它区分「运行中 / 崩溃后等待重启 / 真的停了 / 问不到」。
 * 把这四种情况压成一个布尔值正是实例状态在运行与停止之间来回跳的根源。
 */
export async function inspectInstanceShardRuntime(
  instanceId: string,
  shard: ConsoleCommandShard = 'master',
): Promise<InstanceShardRuntimeProbe> {
  const ref = await resolveConsoleCommandContainerRef(instanceId, shard)
  if (!ref) {
    return { unitExists: false, snapshot: null }
  }
  try {
    return { unitExists: true, snapshot: await getContainerRuntime().inspect(ref) }
  }
  catch {
    return { unitExists: true, snapshot: null }
  }
}

function stopLogFollow(instanceId: string) {
  for (const [key, controller] of logFollowAbortControllers.entries()) {
    if (key === instanceId || key.startsWith(`${instanceId}:`)) {
      controller.abort()
      logFollowAbortControllers.delete(key)
    }
  }
}

function stopShardLogFollow(instanceId: string, shard: ConsoleCommandShard) {
  const key = logFollowKey(instanceId, shard)
  logFollowAbortControllers.get(key)?.abort()
  logFollowAbortControllers.delete(key)
}

/** journalctl 权限不足时写在 stderr 的提示：面板读不到它会把它当成一条普通日志显示 */
const JOURNAL_PERMISSION_HINT = /No journal files were opened|insufficient permissions/i

/** 实例目录内游戏自己写的启动日志（面板读不到系统日志时，用户据此排查崩溃原因） */
function resolveShardGameLogHint(shard: ConsoleCommandShard): string {
  const shardDir = shard === 'caves' ? 'Caves' : 'Master'
  return `${DST_STORAGE_DIR}/${DST_CONF_DIR}/${DST_CLUSTER_NAME}/${shardDir}/server_log.txt`
}

function startShardLogFollow(instanceId: string, ref: ContainerRef, shard: ConsoleCommandShard) {
  stopShardLogFollow(instanceId, shard)
  const key = logFollowKey(instanceId, shard)
  const controller = new AbortController()
  logFollowAbortControllers.set(key, controller)
  const label = CONSOLE_SHARD_LABEL[shard]
  instanceConsoleLogStore.appendSystem(instanceId, `已连接${label}运行时，开始采集控制台输出`, shard)
  void (async () => {
    const runtime = getContainerRuntime()
    let permissionHintShown = false
    try {
      for await (const line of runtime.logs(ref, { follow: true, tail: 100, signal: controller.signal })) {
        if (controller.signal.aborted) {
          break
        }
        if (JOURNAL_PERMISSION_HINT.test(line.text)) {
          // 这条是 journalctl 的报错，不是游戏输出：换成一句能指导排查的说明，
          // 否则控制台看起来像「服务器什么都没说」，把真正的崩溃原因藏起来。
          if (!permissionHintShown) {
            permissionHintShown = true
            instanceConsoleLogStore.appendSystem(
              instanceId,
              `${label}日志暂时取不到（面板没有读取系统日志的权限）。完整的启动与报错信息在实例目录的 ${resolveShardGameLogHint(shard)}`,
              shard,
            )
          }
          continue
        }
        instanceConsoleLogStore.appendDockerLine(instanceId, line.text, shard)
      }
    }
    catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        instanceConsoleLogStore.appendSystem(instanceId, `${label}日志流中断: ${message}`, shard)
      }
    }
  })()
}

export function startContainerLogFollow(instanceId: string, ref: ContainerRef) {
  startShardLogFollow(instanceId, ref, 'master')
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

/** 读取指定分片容器最近日志行（不依赖面板内存日志流，面板重启后仍可用） */
export async function readRecentInstanceContainerLogLines(
  instanceId: string,
  tail = 80,
  shard: ConsoleCommandShard = 'master',
): Promise<string[]> {
  const ref = await resolveConsoleCommandContainerRef(instanceId, shard)
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
  const runtime = getContainerRuntime()
  const masterRef = await resolveInstanceContainerRef(instanceId)
  if (masterRef) {
    const inspect = await runtime.inspect(masterRef)
    if (inspect.running && !logFollowAbortControllers.has(logFollowKey(instanceId, 'master'))) {
      startShardLogFollow(instanceId, masterRef, 'master')
    }
  }
  const cavesRef = await resolveCavesContainerRef(instanceId)
  if (cavesRef) {
    const inspect = await runtime.inspect(cavesRef)
    if (inspect.running && !logFollowAbortControllers.has(logFollowKey(instanceId, 'caves'))) {
      startShardLogFollow(instanceId, cavesRef, 'caves')
    }
  }
}

/**
 * 镜像类错误只在 Docker 模式翻译：Native 模式没有镜像，它的报错原文里带着
 * unit 诊断（systemd 的原始抱怨、unit 文件内容），必须原样透出，不能被镜像文案顶掉。
 */
function formatShardStartError(raw: string, gameDstImage: string, runtimeMode: 'docker' | 'native'): string {
  return runtimeMode === 'docker' ? formatGameDstImageError(raw, gameDstImage) : raw
}

async function startSingleShardContainer(
  runtime: ContainerRuntime,
  spec: ShardContainerSpec,
  gameDstImage: string,
  runtimeMode: 'docker' | 'native',
): Promise<{ ok: true, ref: ContainerRef } | { ok: false, message: string }> {
  let ref: ContainerRef
  try {
    ref = await runtime.createShardContainer(spec)
  }
  catch (error) {
    const raw = error instanceof Error ? error.message : '创建分片运行时失败'
    return { ok: false, message: formatShardStartError(raw, gameDstImage, runtimeMode) }
  }
  try {
    await runtime.start(ref)
  }
  catch (error) {
    await runtime.remove(ref)
    const raw = error instanceof Error ? error.message : '分片运行时启动失败'
    return { ok: false, message: formatShardStartError(raw, gameDstImage, runtimeMode) }
  }
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    const logTail = await readRecentContainerLogs(runtime, ref)
    await runtime.remove(ref)
    const hint = logTail || '分片启动后立即退出，请检查安装目录与分片配置'
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
    return { ok: false, message: '当前仅支持饥荒（343050）实例启动' }
  }
  const memoryPressure = assessHostMemoryForHeavyOperation('dst-container-start')
  if (!memoryPressure.ok) {
    return { ok: false, message: memoryPressure.detail, hostMemoryPressure: memoryPressure }
  }
  const { gameDstImage, instancesRoot, runtimeMode } = getServerContainerConfig()
  let containerGameRoot = input.installPath
  let hostBinds: string[] = []
  let bindMode = 'native'
  if (runtimeMode === 'docker') {
    const docker = createDockerClient()
    const bindPlan = await resolveInstanceContainerBind(docker, input.installPath, instancesRoot)
    if (bindPlan.error) {
      return { ok: false, message: bindPlan.error }
    }
    containerGameRoot = bindPlan.containerGameRoot
    hostBinds = bindPlan.hostBinds
    bindMode = bindPlan.mode
  }
  const clusterInput = {
    instanceName: input.instanceName,
    gamePort: input.gamePort,
  }
  const masterSpec = buildDstMasterShardContainerSpec({
    instanceId: input.instanceId,
    hostInstallPath: input.installPath,
    image: gameDstImage,
    containerGameRoot,
    clusterInput,
  })
  if (!masterSpec) {
    const readiness = diagnoseDstInstallReadiness(input.installPath)
    const steamcmdImageReady = runtimeMode === 'docker'
      ? await isSteamcmdImagePresent()
      : await isSteamcmdRuntimeReady()
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
    try {
      // 洞穴目录新建后需重写 Caves modoverrides（与启动前全量 sync 条件不同）
      await syncInstanceModFilesFromDb(input.instanceId, input.installPath)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '同步 Mod 配置失败'
      return { ok: false, message }
    }
  }
  const cavesConfigured = shardEnabled && isCavesShardConfigured(input.installPath)
  if (shardEnabled && !cavesConfigured) {
    return { ok: false, message: '已开启洞穴分片但无法准备洞穴配置，请检查安装目录权限后重试' }
  }
  const masterFields = readMasterServerIniFields(input.installPath, input.gamePort)
  const cavesFields = shardEnabled && cavesConfigured
    ? readCavesServerIniFields(input.installPath)
    : null
  const reservedPorts = await collectReservedDstPortsOnNode(LOCAL_NODE_ID, input.instanceId, {
    onlyRunning: true,
  })
  const portError = await validateShardPortsForStart(masterFields, cavesFields, {
    reservedPorts,
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
      containerGameRoot,
      clusterInput,
    })
    if (!cavesSpec) {
      return { ok: false, message: '无法构建洞穴分片运行规格，请检查游戏文件是否完整' }
    }
  }
  if (runtimeMode === 'docker') {
    app.log.info({ gameDstImage, bindMode, hostBinds, shardEnabled }, '确保 DST 运行镜像可用')
    const imagePull = await pullGameDstImage()
    if (!imagePull.ok) {
      return { ok: false, message: imagePull.error }
    }
    masterSpec.hostBinds = hostBinds
    if (cavesSpec) {
      cavesSpec.hostBinds = hostBinds
    }
  }
  else {
    app.log.info({ runtimeMode, installPath: input.installPath, shardEnabled }, '使用 Native systemd 运行 DST')
  }
  const runtime = getContainerRuntime()
  let shardNetworkName: string | undefined
  if (shardEnabled && cavesConfigured) {
    const interconnectChanged = runtimeMode === 'docker'
      ? ensureDockerShardInterconnectConfig(input.installPath, input.instanceId)
      : ensureNativeShardInterconnectConfig(input.installPath)
    if (interconnectChanged) {
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
    const result = await startSingleShardContainer(runtime, spec, gameDstImage, runtimeMode)
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
    instanceConsoleLogStore.appendSystem(input.instanceId, '洞穴分片已启动', 'caves')
    startShardLogFollow(input.instanceId, cavesStart.ref, 'caves')
  }
  const ref = masterStart.ref
  const displayCommand = masterSpec.cmd.join(' ')
  app.log.info({
    instanceId: input.instanceId,
    containerId: ref.id,
    name: ref.name,
    command: displayCommand,
    shardEnabled,
  }, '实例运行时已启动')
  startShardLogFollow(input.instanceId, ref, 'master')
  return { ok: true, ref, displayCommand }
}

export async function stopInstanceContainer(instanceId: string): Promise<void> {
  stopLogFollow(instanceId)
  const instance = await getGameInstanceById(instanceId)
  const runtime = getContainerRuntime()
  const cavesRef = await resolveCavesContainerRef(instanceId)
  const masterRef = await resolveInstanceContainerRef(instanceId)
  if (cavesRef) {
    instanceConsoleLogStore.appendSystem(instanceId, '正在停止并移除洞穴分片以释放内存')
  }
  await stopAndRemoveShard(runtime, cavesRef)
  if (masterRef) {
    instanceConsoleLogStore.appendSystem(instanceId, '正在停止并移除主世界分片以释放内存')
  }
  await stopAndRemoveShard(runtime, masterRef)
  if (masterRef) {
    instanceConsoleLogStore.appendSystem(instanceId, '实例运行时已删除')
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
    instanceConsoleLogStore.appendSystem(instanceId, '实例运行时已删除')
  }
  await runtime.removeShardNetwork(instanceId)
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
  options?: { silent?: boolean },
): Promise<{ ok: boolean, message?: string }> {
  const trimmed = command.trim()
  if (!trimmed) {
    return { ok: false, message: '命令不能为空' }
  }
  const ref = await resolveConsoleCommandContainerRef(instanceId, shard)
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
  // 面板自己的周期查询（在线人数 / 名单）传 silent：它们不是用户发的命令，
  // 不该每隔几十秒就往控制台里塞一条命令行回显
  if (!options?.silent) {
    instanceConsoleLogStore.appendSystem(instanceId, `> ${trimmed}`, shard)
  }
  if (result.exitCode !== 0) {
    return { ok: false, message: result.output || '命令发送失败' }
  }
  return { ok: true }
}
