import type { FastifyInstance } from 'fastify'
import type { HostMemoryPressureFailure } from '../../infra/container/host-resource-guard'
import fs from 'node:fs'
import net from 'node:net'
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
import { getGameInstanceById, listInstanceMods, updateGameInstanceRuntime } from '../../shared/db/index'
import { resolveClusterPaths } from '../../infra/game-adapter/dst/cluster-service'
import { parseClusterIni } from '../../infra/game-adapter/dst/cluster-ini'
import { describeSystemdExitReason, resolveShardMemoryCapMb } from '../../infra/container/exit-reason'

/** 主世界分片互联端口（cluster.ini [SHARD] master_port）；读不到时退回 DST 默认值 */
const DEFAULT_DST_MASTER_PORT = 10888
/**
 * 等待主世界就绪的默认上限（秒）。
 *
 * 给足余量：36 个 Mod 的分片在 2 核机上冷启动要两分多钟，多 Mod 存档更久。
 * 上限拉长没有副作用——主世界的分片端口一打开就立即返回，等待只用来卡住洞穴；
 * 真正有害的是「等不够就放洞穴进来」，那会让两个加载峰值重新叠在一起。
 */
const DEFAULT_SHARD_READY_WAIT_SEC = 900

/** 就绪等待上限；可用 GSH_SHARD_READY_WAIT_SEC 覆盖（小机器上 Mod 特别多时可再调大） */
export function resolveShardReadyWaitSec(): number {
  const raw = process.env.GSH_SHARD_READY_WAIT_SEC?.trim()
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_SHARD_READY_WAIT_SEC
}

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

/**
 * 分片日志来源已改为 systemd 直接追加到面板可读的文件（见 NativeSystemdRuntime），
 * 不再依赖 journald 权限。这里保留一条兜底：万一文件读不到，至少告诉用户去哪找
 * 游戏自己写的 server_log.txt。
 */
const JOURNAL_PERMISSION_HINT = /No journal files were opened|insufficient permissions/i

/** 实例目录内游戏自己写的启动日志（面板读不到分片日志时，用户据此排查崩溃原因） */
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
          // 万一还是读到了系统日志的报错（不是游戏输出）：换成一句能指导排查的说明，
          // 否则控制台看起来像「服务器什么都没说」，把真正的崩溃原因藏起来。
          if (!permissionHintShown) {
            permissionHintShown = true
            instanceConsoleLogStore.appendSystem(
              instanceId,
              `${label}分片日志暂时取不到。请查看实例目录的 ${resolveShardGameLogHint(shard)}，或服务器上的 systemctl --user status 输出`,
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

/** 启用中且内容已就绪的 Mod 数量：内存估算的直接输入 */
export async function countEnabledInstanceMods(instanceId: string): Promise<number> {
  try {
    const mods = await listInstanceMods(instanceId)
    return mods.filter(mod => mod.enabled && mod.installStatus === 'ready').length
  }
  catch {
    return 0
  }
}

/**
 * DB 记为已停止时，运行时探测到的快照是否真的代表「实例还在正常服务」。
 *
 * 正在被 systemd 自动拉起（`Restart=on-failure` 的 auto-restart 窗口）或已经重启过，
 * 属于崩溃循环而不是「容器还在跑」。若此时把状态翻回运行中，就会抹掉上一趟对账刚写入
 * 的崩溃告警——线上实测同一个请求里两趟对账互相覆盖，服主永远看不到「主世界已停止」。
 */
export function isHealthyRuntimeForResurrect(snapshot: ContainerInspect | null): boolean {
  if (!snapshot?.running) {
    return false
  }
  return !snapshot.restarting && (snapshot.restarts ?? 0) === 0
}

/** 主世界分片互联端口（cluster.ini [SHARD] master_port）；读不到时退回 DST 默认值 */
export function readClusterMasterPort(installPath: string): number {  try {
    const { clusterIniPath } = resolveClusterPaths(installPath)
    const { fields } = parseClusterIni(fs.readFileSync(clusterIniPath, 'utf8'))
    return Number.isInteger(fields.masterPort) && fields.masterPort > 0 && fields.masterPort <= 65535
      ? fields.masterPort
      : DEFAULT_DST_MASTER_PORT
  }
  catch {
    return DEFAULT_DST_MASTER_PORT
  }
}

/** 单次 TCP 连通探测：主世界完成 Lua 初始化、分片监听端口打开后才会接受连接 */
function probeTcpPort(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const finish = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/**
 * 等主世界就绪后再拉起洞穴。
 *
 * 两个分片同时加载时，各自都要把整套 Mod 与世界读一遍：2 核 4G 机器上两个峰值叠在
 * 一起会触发整机 OOM（线上实测主世界 anon-rss 已达 2.0 GiB 时被内核杀掉），而洞穴
 * 此时连不上主世界，只会反复报 `Connection to master failed`，最后两个分片都白跑。
 * 主世界先跑完，洞穴再加载时页缓存已经热了，整机峰值只剩原来的一个多一点。
 */
export type MasterReadyOutcome =
  /** 主世界分片端口已可连接，洞穴可以起来了 */
  | { kind: 'ready' }
  /** 等满上限仍未就绪：照常启动洞穴，但要在控制台说明原因 */
  | { kind: 'timed-out' }
  /** 主世界进程已不在（退出或被运行时放弃拉起） */
  | { kind: 'stopped', detail: string }
  /** 主世界在崩溃循环里反复重启，永远不会就绪 */
  | { kind: 'restart-loop', detail: string }

export type MasterProbeVerdict = 'healthy' | 'unknown' | 'stopped' | 'restart-loop'

/**
 * 等待期间对主世界分片快照的判决。
 *
 * `unknown`（问不到运行时）必须继续等：user bus 抖动一次就判崩溃会误伤正常启动。
 * `restart-loop` 必须判失败：`Restart=on-failure` 的重启窗口里单元仍算「在运行」，
 * 只按这一条判断就会白等满上限、然后照样把洞穴拉起来占内存。
 */
export function classifyMasterProbe(snapshot: ContainerInspect | null): MasterProbeVerdict {
  if (!snapshot) {
    return 'unknown'
  }
  if (!snapshot.running) {
    return 'stopped'
  }
  if (snapshot.restarting || (snapshot.restarts ?? 0) > 0) {
    return 'restart-loop'
  }
  return 'healthy'
}

/**
 * 等主世界就绪后再拉起洞穴。
 *
 * 两个分片同时加载时，各自都要把整套 Mod 与世界读一遍：2 核 4G 机器上两个峰值叠在
 * 一起会触发整机 OOM（线上实测主世界 anon-rss 已达 2.0 GiB 时被内核杀掉），而洞穴
 * 此时连不上主世界，只会反复报 `Connection to master failed`，最后两个分片都白跑。
 * 主世界先跑完，洞穴再加载时页缓存已经热了，整机峰值只剩原来的一个多一点。
 *
 * 崩溃循环必须当成失败：`Restart=on-failure` 的重启窗口里单元仍算「在运行」，
 * 若只按这一条判断就会白等满上限、然后照样把洞穴拉起来占内存。
 */
export async function waitForMasterShardReady(
  app: FastifyInstance,
  instanceId: string,
  masterRef: ContainerRef,
  masterPort: number,
  waitSec = resolveShardReadyWaitSec(),
): Promise<MasterReadyOutcome> {
  const runtime = getContainerRuntime()
  const startAt = Date.now()
  const deadline = startAt + waitSec * 1000
  let lastHeartbeat = startAt
  while (Date.now() < deadline) {
    if (await probeTcpPort(masterPort)) {
      return { kind: 'ready' }
    }
    let snapshot: ContainerInspect | null = null
    try {
      snapshot = await runtime.inspect(masterRef)
    }
    catch {
      // 问不到运行时（user bus 抖动等）：当作还活着，继续等，别误判成崩溃
      snapshot = null
    }
    const verdict = classifyMasterProbe(snapshot)
    if (verdict === 'stopped') {
      const reason = describeSystemdExitReason(snapshot?.exitResult, resolveShardMemoryCapMb())
      return {
        kind: 'stopped',
        detail: reason ? `主世界分片在加载途中退出：${reason}` : '主世界分片在加载途中退出',
      }
    }
    if (verdict === 'restart-loop') {
      const reason = describeSystemdExitReason(snapshot?.exitResult, resolveShardMemoryCapMb())
      return {
        kind: 'restart-loop',
        detail: `主世界分片反复重启（已重启 ${snapshot?.restarts ?? 0} 次）${reason ? `，最近一次退出：${reason}` : ''}`,
      }
    }
    const now = Date.now()
    if (now - lastHeartbeat >= 30_000) {
      lastHeartbeat = now
      const waited = Math.round((now - startAt) / 1000)
      instanceConsoleLogStore.appendSystem(
        instanceId,
        `主世界仍在加载（已等待 ${waited} 秒），就绪后再启动洞穴分片`,
        'master',
      )
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  app.log.warn({ instanceId, masterPort, waitSec }, '等待主世界就绪超时，仍继续启动洞穴分片')
  return { kind: 'timed-out' }
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
  // 内存守卫放在这里而不是函数开头：只有知道「要不要起洞穴、挂了多少 Mod」，
  // 估算才对得上实际峰值。线上就是因为固定按单分片 512 MiB 放行，
  // 36 个 Mod 的双分片启动在加载途中被内核 OOM 杀掉。
  const memoryPressure = assessHostMemoryForHeavyOperation('dst-container-start', {
    shardCount: cavesConfigured ? 2 : 1,
    modCount: await countEnabledInstanceMods(input.instanceId),
  })
  if (!memoryPressure.ok) {
    return { ok: false, message: memoryPressure.detail, hostMemoryPressure: memoryPressure }
  }
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
  const masterStart = await startSingleShardContainer(runtime, masterSpec, gameDstImage, runtimeMode)
  if (!masterStart.ok) {
    return { ok: false, message: `主世界：${masterStart.message}` }
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

  if (cavesSpec) {
    instanceConsoleLogStore.appendSystem(
      input.instanceId,
      '主世界分片已启动，正在加载 Mod 与世界；就绪后再启动洞穴分片',
      'master',
    )
    // 不能在 HTTP 请求里等主世界就绪：36 个 Mod 在 2 核机上要加载两分多钟，
    // 而前端 axios 的超时是 60 秒——同步等待会让面板先报「启动失败」，
    // 实际却已经起来了。这里放到后台，主世界本身就已经算「实例在运行」。
    void startCavesAfterMasterReady(app, {
      instanceId: input.instanceId,
      installPath: input.installPath,
      masterRef: ref,
      cavesSpec,
      startCaves: async () => {
        const result = await startSingleShardContainer(runtime, cavesSpec, gameDstImage, runtimeMode)
        return result.ok ? { ok: true as const, ref: result.ref } : { ok: false as const, message: `洞穴：${result.message}` }
      },
    })
  }
  return { ok: true, ref, displayCommand }
}

/**
 * 后台等主世界就绪再拉起洞穴，并在失败时如实上报。
 *
 * 两个分片同时加载会把整机内存吃穿（线上实测主世界 anon-rss 2.0 GiB 时被内核 OOM 杀掉），
 * 而主世界崩了以后洞穴连不上它、只会反复重连失败，白占内存。所以主世界没站住就中止，
 * 并把状态写成 error——用 whereStatus 守卫，避免用户在等待期间主动停止实例后又被改回错误态。
 */
async function startCavesAfterMasterReady(
  app: FastifyInstance,
  input: {
    instanceId: string
    installPath: string
    masterRef: ContainerRef
    cavesSpec: ShardContainerSpec
    startCaves: () => Promise<{ ok: true, ref: ContainerRef } | { ok: false, message: string }>
  },
): Promise<void> {
  const runtime = getContainerRuntime()
  const failStart = async (message: string) => {
    await stopAndRemoveShard(runtime, input.masterRef)
    instanceConsoleLogStore.appendSystem(input.instanceId, message, 'caves')
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'error',
      containerId: null,
      runtimePid: null,
      runtimeStartedAt: null,
      lastError: message,
      whereStatus: 'running',
    })
    app.log.error({ instanceId: input.instanceId }, message)
  }
  try {
    const readiness = await waitForMasterShardReady(
      app,
      input.instanceId,
      input.masterRef,
      readClusterMasterPort(input.installPath),
    )
    if (readiness.kind === 'stopped' || readiness.kind === 'restart-loop') {
      await failStart(
        `${readiness.detail}，已中止启动洞穴分片。内存不足时可先执行 gsh setup-swap 增加 swap，'
        + '或在「世界设置 → 模组」减少订阅的 Mod；完整日志见控制台。`,
      )
      return
    }
    if (readiness.kind === 'timed-out') {
      instanceConsoleLogStore.appendSystem(
        input.instanceId,
        `等待主世界就绪超时（${resolveShardReadyWaitSec()} 秒），仍继续启动洞穴分片；若洞穴反复重连失败请检查主世界日志`,
        'caves',
      )
    }
    const cavesStart = await input.startCaves()
    if (!cavesStart.ok) {
      await failStart(cavesStart.message)
      return
    }
    instanceConsoleLogStore.appendSystem(input.instanceId, '洞穴分片已启动', 'caves')
    startShardLogFollow(input.instanceId, cavesStart.ref, 'caves')
  }
  catch (error) {
    app.log.error({ instanceId: input.instanceId, err: error }, '等待主世界就绪或启动洞穴分片时发生异常')
  }
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
