import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { DstInstanceSummariesDto } from '../../../../shared/contracts/dst-summary'
import {
  createInstanceBodySchema,
  instanceActionBodySchema,
  instanceIdsBodySchema,
  instanceInstallLogQuerySchema,
  instanceListQuerySchema,
} from '../../../../shared/contracts/instance'
import type {
  InstanceInstallLogPayload,
  InstanceListQuery,
  InstallableGameItem,
} from '../../../../shared/contracts/instance'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import {
  createGameInstance,
  deleteGameInstanceById,
  getGameInstanceById,
  getServerNodeById,
  getSystemSteamcmdConfig,
  listGameInstances,
  updateGameInstanceRuntime,
} from '../../shared/db/index'
import {
  deleteInstallLogFile,
  readInstallLogContent,
} from '../../shared/instance-install/log-store'
import { formatInstallLogContent } from '../../shared/instance-install/log-format'
import { isSteamcmdAppUpdateBusy } from '../../infra/container/steamcmd-app-update-queue'
import { isSteamcmdImagePresent } from '../../infra/container'
import {
  buildDstStartBlockedMessage,
  diagnoseDstInstallReadiness,
} from '../../infra/game-adapter/dst/install-readiness'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { ensureDstLayout } from '../../infra/game-adapter/dst/cluster-config'
import { syncInstanceModFilesFromDb } from '../mod/mod-file-sync-service'
import { allocateDstGamePort } from './dst-port-service'
import { registerDstContainerCommandPort } from '../../shared/instance/dst-container-command-port'
import { applyDstPortAutoAllocate, probeDstPortConflictForStart, resolveDstGamePortForStart } from './dst-port-sync'
import { ErrorCode } from '../../../../shared/constants/error-code'
import {
  ensureContainerRuntimeReady,
  ensureInstanceContainerLogFollow,
  isInstanceContainerRunning,
  removeInstanceContainer,
  resolveDefaultInstanceInstallPath,
  resolveInstanceContainerRef,
  readRecentInstanceContainerLogLines,
  sendInstanceContainerCommand,
  startInstanceContainer,
  stopInstanceContainer,
} from './container-lifecycle'
import {
  cancelInstallJob,
  clearInstallJobTracking,
  getInstallLogsDirPath,
  getSteamcmdLoginCredentials,
  getInstallHostMemoryPressure,
  isAnyInstallJobActive,
  isInstallJobActive,
  mapDbInstallLogStatusToResponse,
  reconcileOrphanedSteamcmdOnPanelReady,
  reconcileStaleInstallingInstances,
  shouldAllowInstallDespiteUpToDate,
  startInstallJob,
} from './install-service'
import { prepareInstallPathForRuntime, prepareInstallPathForSteamcmd } from './install-path'
import { businessError, success } from '../../shared/http/response'
import { hostMemoryPressureError } from '../../shared/http/host-memory-pressure-error'
import { instanceConsoleLogStore } from '../../shared/instance-runtime/console-log-store'
import { registerInstanceMetricsRoute } from './metrics'
import { registerInstanceRoutes } from './instance-routes'
import { getDstInstanceSummaries } from './dst-summary'
import type { InstanceUpdateCheckJobStatus } from './update-check'
import { readLocalBuildId } from '../../shared/steam-update/build-id'
import {
  enqueueInstanceUpdateCheck,
  getInstanceUpdateCheckJobStatus,
  needsRemoteUpdatePrecheck,
  refreshInstanceUpdateStatus,
  resolveStartBlockedByPendingUpdate,
  resolveSteamcmdCommandForUpdateCheck,
  scheduleInstanceUpdateChecks,
} from './update-check'
import { requirePermission } from '../system/auth'
import { loadServerConfig } from '../../shared/config'

const LOCAL_NODE_ID = 'local-node'
const DANGEROUS_WINDOWS_PATHS = [
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  'Users',
]
const INSTALLABLE_GAMES: InstallableGameItem[] = [
  {
    appId: '343050',
    name: '饥荒联机（Dedicated Server）',
    steamcmdLoginMode: 'anonymous',
  },
]

async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  return requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
}

function normalizePort(value: number | undefined): number | null {
  if (typeof value === 'undefined') {
    return null
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null
  }
  return value
}

function normalizeInstallPath(value: string | undefined): string {
  return value?.trim() ?? ''
}

function resolveInstallableGameByAppId(value: string | undefined): InstallableGameItem | undefined {
  const appId = value?.trim() ?? ''
  return INSTALLABLE_GAMES.find(game => game.appId === appId)
}

async function getDefaultSteamInstallPath(_gameCode: string, instanceId: string): Promise<string> {
  return resolveDefaultInstanceInstallPath(instanceId)
}

async function checkContainerInstallReady(): Promise<{ ok: boolean, message?: string }> {
  return ensureContainerRuntimeReady()
}

async function requireContainerRuntime(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  const runtimeReady = await checkContainerInstallReady()
  if (!runtimeReady.ok) {
    return businessError(runtimeReady.message ?? '游戏运行时未就绪', request)
  }
}

/** Linux 系统目录黑名单：实例目录不得落入（对 POSIX 绝对路径生效） */
const DANGEROUS_POSIX_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/boot',
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/root',
]

export interface InstallPathValidationOptions {
  /** 实例根目录（GSH_INSTANCES_ROOT） */
  instancesRoot?: string
  /** instances-root=必须位于实例根目录之下；缺省时仅做危险目录过滤（兼容既有实例的启动/删除） */
  policy?: 'instances-root' | 'any'
}

function validateInstallPath(rawPath: string, options: InstallPathValidationOptions = {}): string | undefined {
  if (!rawPath) {
    return '安装路径不能为空'
  }
  if (!path.isAbsolute(rawPath)) {
    return '安装路径必须为绝对路径'
  }
  if (/[\0`$;&|]/.test(rawPath)) {
    return '安装路径包含危险字符'
  }
  const normalized = path.normalize(rawPath)
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  if (segments.includes('..')) {
    return '安装路径不能包含上级目录跳转'
  }
  const resolved = path.resolve(normalized)
  const root = path.parse(resolved).root
  if (resolved === root) {
    return '安装路径不能为磁盘根目录'
  }
  if (process.platform === 'win32') {
    const blocked = DANGEROUS_WINDOWS_PATHS.map((item) => {
      return path.resolve(root, item).toLowerCase()
    })
    const resolvedLower = resolved.toLowerCase()
    if (blocked.some(item => resolvedLower === item || resolvedLower.startsWith(`${item}\\`))) {
      return '安装路径命中过滤规则，请使用业务目录'
    }
  }
  // Linux 系统目录黑名单：防止实例目录（以及删除时的 rmSync -rf）触达 /etc、/usr 等。
  if (resolved.startsWith('/')) {
    const resolvedLower = resolved.toLowerCase()
    if (DANGEROUS_POSIX_PREFIXES.some(item => resolvedLower === item || resolvedLower.startsWith(`${item}/`))) {
      return '安装路径命中系统目录过滤规则，请使用实例数据目录'
    }
  }
  // 创建实例时强制收敛到实例根目录，杜绝"实例管理员≈宿主 root"的挂载提权路径。
  if (options.policy === 'instances-root' && options.instancesRoot) {
    const instancesRoot = path.resolve(options.instancesRoot)
    const relative = path.relative(instancesRoot, resolved)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return '安装路径必须位于实例数据目录（GSH_INSTANCES_ROOT）之下；如确需自定义目录，请设置 GSH_INSTALL_PATH_POLICY=any 并自行承担隔离风险'
    }
  }
}

/**
 * 服务重启后 DB 可能仍保留 running；与 Docker 实际状态对齐。
 */
async function reconcileStaleRunningInstances(app: FastifyInstance): Promise<number> {
  const instances = await listGameInstances({ status: 'running' })
  let reconciled = 0
  for (const instance of instances) {
    if (instance.nodeId !== LOCAL_NODE_ID) {
      continue
    }
    const running = await isInstanceContainerRunning(instance.id)
    if (running) {
      if (!instance.runtimeStartedAt) {
        await updateGameInstanceRuntime(instance.id, {
          runtimeStartedAt: new Date().toISOString(),
        })
      }
      await ensureInstanceContainerLogFollow(instance.id)
      continue
    }
    await updateGameInstanceRuntime(instance.id, {
      status: 'stopped',
      containerId: null,
      runtimePid: null,
      runtimeStartedAt: null,
    })
    reconciled++
    app.log.info({ instanceId: instance.id }, '实例运行时不存在，已同步状态为已停止')
  }
  return reconciled
}

/**
 * DB 为 stopped/error 但容器仍在运行时的对齐（如异常退出后面板重启）。
 */
async function reconcileStoppedButContainerRunning(app: FastifyInstance): Promise<number> {
  const instances = await listGameInstances()
  let reconciled = 0
  for (const instance of instances) {
    if (instance.nodeId !== LOCAL_NODE_ID) {
      continue
    }
    if (instance.status !== 'stopped' && instance.status !== 'error') {
      continue
    }
    if (!await isInstanceContainerRunning(instance.id)) {
      continue
    }
    const ref = await resolveInstanceContainerRef(instance.id)
    await updateGameInstanceRuntime(instance.id, {
      status: 'running',
      containerId: ref?.id ?? instance.containerId,
      runtimeStartedAt: instance.runtimeStartedAt ?? new Date().toISOString(),
      lastError: null,
    })
    await ensureInstanceContainerLogFollow(instance.id)
    reconciled++
    app.log.info({ instanceId: instance.id }, '实例运行时仍在运行，已同步状态为运行中')
  }
  return reconciled
}

async function reconcileInstanceRuntimeState(app: FastifyInstance): Promise<void> {
  await reconcileStaleRunningInstances(app)
  await reconcileStoppedButContainerRunning(app)
  await reconcileStaleInstallingInstances(app)
}

async function handleListInstances(
  app: FastifyInstance,
  request: FastifyRequest,
  payload: InstanceListQuery,
): Promise<ApiSuccessResponse<Awaited<ReturnType<typeof listGameInstances>>> | ApiErrorResponse> {
  const authError = await verifyAuthorized(request)
  if (authError) {
    return authError
  }
  await reconcileInstanceRuntimeState(app)
  const status = payload.status
  const instances = await listGameInstances({
    nodeId: payload.nodeId?.trim() || undefined,
    status: status && ['pending_install', 'running', 'stopped', 'installing', 'error'].includes(status)
      ? status
      : undefined,
    keyword: payload.keyword?.trim() || undefined,
  })
  return success(instances, request)
}

/**
 * instance 模块注册入口
 * 负责游戏实例生命周期管理（创建、启动、停止、重启、删除）。
 */
export function registerInstanceModule(app: FastifyInstance) {
  registerInstanceRoutes(app, registerInstanceRouteHandlers)
}

function registerInstanceRouteHandlers(app: FastifyInstance) {
  registerDstContainerCommandPort({
    isInstanceContainerRunning,
    readRecentInstanceContainerLogLines,
    sendInstanceContainerCommand,
  })
  registerInstanceMetricsRoute(app)
  app.post('/app/instance/list', async (request) => {
    const body = instanceListQuerySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    return handleListInstances(app, request, body.data)
  })

  app.post('/app/instance/dst-summaries', async (request): Promise<ApiSuccessResponse<DstInstanceSummariesDto> | ApiErrorResponse> => {
    const body = instanceListQuerySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    await reconcileInstanceRuntimeState(app)
    const instances = await listGameInstances({
      nodeId: body.data.nodeId?.trim() || undefined,
      status: body.data.status,
      keyword: body.data.keyword?.trim() || undefined,
    })
    return success(await getDstInstanceSummaries(instances), request)
  })

  app.get('/app/instance/games', async (request): Promise<ApiSuccessResponse<InstallableGameItem[]> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    return success(INSTALLABLE_GAMES, request)
  })

  app.get('/app/instance/install-log', async (request): Promise<ApiSuccessResponse<InstanceInstallLogPayload> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = instanceInstallLogQuerySchema.safeParse(request.query ?? {})
    if (!query.success) {
      return businessError('请求参数无效', request)
    }
    const id = query.data.id
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const instance = await getGameInstanceById(id)
    if (!instance) {
      return businessError('实例不存在', request)
    }
    const fileContent = readInstallLogContent(getInstallLogsDirPath(), id)
    if (fileContent) {
      return success<InstanceInstallLogPayload>({
        content: formatInstallLogContent(fileContent),
        status: mapDbInstallLogStatusToResponse(instance.installLogStatus, instance.status),
        updatedAt: instance.installLogUpdatedAt ?? instance.updatedAt,
        source: 'install_log',
      }, request)
    }
    if (isInstallJobActive(id)) {
      return success<InstanceInstallLogPayload>({
        content: '安装任务已启动，等待 SteamCMD 输出...',
        status: 'running',
        updatedAt: instance.installLogUpdatedAt ?? instance.updatedAt,
        source: 'install_log',
      }, request)
    }
    const summaryLines = [instance.lastCommand, instance.lastError]
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!summaryLines) {
      return success<InstanceInstallLogPayload>({
        content: '暂无 SteamCMD 安装输出。',
        status: 'unknown',
        updatedAt: instance.updatedAt,
        source: 'empty',
      }, request)
    }
    return success<InstanceInstallLogPayload>({
      content: formatInstallLogContent([
        '【最近状态摘要，非完整 SteamCMD 输出】',
        '',
        summaryLines,
      ].join('\n')),
      status: mapDbInstallLogStatusToResponse(instance.installLogStatus, instance.status),
      updatedAt: instance.installLogUpdatedAt ?? instance.updatedAt,
      source: 'status_summary',
    }, request)
  })

  app.post('/app/instance/create', async (request): Promise<ApiSuccessResponse<Awaited<ReturnType<typeof createGameInstance>>> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const parsed = createInstanceBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return businessError('请求参数无效', request)
    }
    const body = parsed.data
    const nodeId = body.nodeId
    const name = body.name
    const gameCode = body.gameCode
    const manualInstallPath = normalizeInstallPath(body.installPath)
    if (!nodeId) {
      return businessError('请选择节点', request)
    }
    if (nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持在本地节点创建实例', request)
    }
    if (!name) {
      return businessError('实例名称不能为空', request)
    }
    if (!gameCode) {
      return businessError('请选择游戏 AppID', request)
    }
    const selectedGame = resolveInstallableGameByAppId(gameCode)
    if (!selectedGame) {
      return businessError('游戏 AppID 不在可安装列表中', request)
    }
    const steamcmdCredentials = getSteamcmdLoginCredentials()
    const steamcmdConfig = await getSystemSteamcmdConfig()
    const steamcmdCommand = steamcmdConfig?.steamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
    const runtimeReady = await checkContainerInstallReady()
    if (!runtimeReady.ok) {
      return businessError(runtimeReady.message ?? '游戏运行时未就绪', request)
    }
    const instanceId = randomUUID()
    const installPath = manualInstallPath || await getDefaultSteamInstallPath(gameCode, instanceId)
    const pathPolicy = loadServerConfig()
    const installPathError = validateInstallPath(installPath, {
      instancesRoot: pathPolicy.instancesRoot,
      policy: pathPolicy.installPathPolicy,
    })
    if (installPathError) {
      return businessError(installPathError, request)
    }
    const node = await getServerNodeById(nodeId)
    if (!node) {
      return businessError('节点不存在', request)
    }
    const ensureDirError = prepareInstallPathForSteamcmd(installPath)
    if (ensureDirError) {
      return businessError(`安装目录创建失败: ${ensureDirError}`, request)
    }
    if (!manualInstallPath) {
      app.log.info({
        nodeId,
        gameCode: selectedGame.appId,
        installPath,
      }, '创建实例未填写安装目录，已回退到默认实例数据目录')
    }
    let gamePort = normalizePort(body.gamePort)
    if (gameCode === DST_APP_ID && gamePort === null) {
      try {
        gamePort = await allocateDstGamePort(nodeId)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : '无法分配游戏端口'
        return businessError(message, request)
      }
    }
    app.log.info({
      instanceId,
      gameCode,
      installPath,
      gamePort,
      steamcmdCommand,
    }, '实例已创建，后台开始执行 SteamCMD 安装')
    const instance = await createGameInstance({
      id: instanceId,
      nodeId,
      name,
      gameCode,
      status: 'pending_install',
      installPath,
      configPath: body.configPath?.trim() || null,
      queryPort: normalizePort(body.queryPort),
      gamePort,
      rconPort: normalizePort(body.rconPort),
      lastExitCode: null,
      lastCommand: '等待安装任务启动',
      lastError: null,
    })
    const memoryPressure = getInstallHostMemoryPressure()
    if (memoryPressure) {
      return hostMemoryPressureError(memoryPressure, request)
    }
    const started = startInstallJob(app, {
      instanceId,
      appId: gameCode,
      instanceName: name,
      gamePort,
      installPath,
      steamcmdCommand,
      steamcmdCredentials,
    })
    if (started === 'busy') {
      return businessError('该实例已有安装任务进行中', request)
    }
    if (started === 'blocked') {
      const blockedPressure = getInstallHostMemoryPressure()
      if (blockedPressure) {
        return hostMemoryPressureError(blockedPressure, request)
      }
      return businessError('宿主机内存不足，无法启动安装', request)
    }
    return success(instance, request)
  })

  app.post('/app/instance/check-updates', async (request): Promise<ApiSuccessResponse<InstanceUpdateCheckJobStatus> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceIdsBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const steamcmdCommand = await resolveSteamcmdCommandForUpdateCheck()
    const instanceIds = body.data.ids
    const status = enqueueInstanceUpdateCheck({
      steamcmdCommand,
      instanceIds,
      force: false,
      validateRuntime: checkContainerInstallReady,
    })
    return success(status, request)
  })

  app.get('/app/instance/check-updates/status', async (request): Promise<ApiSuccessResponse<InstanceUpdateCheckJobStatus> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    return success(getInstanceUpdateCheckJobStatus(), request)
  })

  app.post('/app/instance/update', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceActionBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const id = body.data.id
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const runtimeError = await requireContainerRuntime(request)
    if (runtimeError) {
      return runtimeError
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    if (current.status === 'running') {
      return businessError('请先停止实例后再更新服务端', request)
    }
    if (current.status === 'pending_install' || current.status === 'installing') {
      return businessError('实例正在安装中，请稍后再试', request)
    }
    if (isInstallJobActive(id)) {
      return businessError('该实例已有安装任务进行中', request)
    }
    const installPath = normalizeInstallPath(current.installPath ?? undefined)
      || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    const ensureDirError = prepareInstallPathForSteamcmd(installPath)
    if (ensureDirError) {
      return businessError(`安装目录创建失败: ${ensureDirError}`, request)
    }
    const steamcmdCredentials = getSteamcmdLoginCredentials()
    const steamcmdConfig = await getSystemSteamcmdConfig()
    const steamcmdCommand = steamcmdConfig?.steamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
    const forceReinstall = shouldAllowInstallDespiteUpToDate({
      status: current.status,
      gameCode: current.gameCode,
      updateAvailable: current.updateAvailable,
    }, installPath, body.data.force)
    const localBuildId = readLocalBuildId(installPath, current.gameCode)
    if (
      !forceReinstall
      && !current.updateAvailable
      && localBuildId
      && current.remoteBuildId
      && localBuildId === current.remoteBuildId
    ) {
      return businessError(
        `当前已是最新版本（Build ${localBuildId}），无需更新`,
        request,
      )
    }
    if (!forceReinstall && needsRemoteUpdatePrecheck(current, localBuildId)) {
      const checked = await refreshInstanceUpdateStatus(current, {
        steamcmdCommand,
        forceRemote: true,
      })
      if (
        checked.localBuildId
        && checked.remoteBuildId
        && !checked.updateAvailable
      ) {
        return businessError(
          `当前已是最新版本（Build ${checked.localBuildId}），无需更新`,
          request,
        )
      }
    }
    const memoryPressure = getInstallHostMemoryPressure()
    if (memoryPressure) {
      return hostMemoryPressureError(memoryPressure, request)
    }
    // 须在 startInstallJob 之前写入 installing：本地复制可在数百毫秒内完成，
    // 若后置写入会覆盖 finalize 已设置的 stopped，重启后面板会误判为安装中断。
    await updateGameInstanceRuntime(id, {
      status: 'installing',
      lastCommand: '正在准备更新服务端...',
      lastError: null,
      installPercent: null,
      installLogStatus: 'running',
    })
    const started = startInstallJob(app, {
      instanceId: id,
      appId: current.gameCode,
      instanceName: current.name,
      gamePort: current.gamePort,
      installPath,
      steamcmdCommand,
      steamcmdCredentials,
    })
    if (started === 'busy') {
      return businessError('该实例已有安装任务进行中', request)
    }
    if (started === 'blocked') {
      const blockedPressure = getInstallHostMemoryPressure()
      if (blockedPressure) {
        return hostMemoryPressureError(blockedPressure, request)
      }
      return businessError('宿主机内存不足，无法启动安装', request)
    }
    app.log.info({
      instanceId: id,
      gameCode: current.gameCode,
      installPath,
      forceReinstall,
    }, '实例开始执行 SteamCMD 手动更新')
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/allocate-ports', async (request): Promise<ApiSuccessResponse<{ gamePort: number }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceActionBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const id = body.data.id
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    if (current.gameCode.trim() !== DST_APP_ID) {
      return businessError('当前仅支持饥荒（343050）实例自动分配端口', request)
    }
    const installPath = normalizeInstallPath(current.installPath ?? undefined) || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    const probe = await probeDstPortConflictForStart({
      instanceId: id,
      nodeId: current.nodeId,
      gameCode: current.gameCode,
      installPath,
      gamePort: current.gamePort,
    })
    const applied = await applyDstPortAutoAllocate({
      instanceId: id,
      nodeId: current.nodeId,
      installPath,
      gamePort: current.gamePort,
      suggestedGamePort: probe.suggestedGamePort,
    })
    if (!applied.ok) {
      return businessError(applied.message, request)
    }
    return success({ gamePort: applied.gamePort }, request)
  })

  app.post('/app/instance/start', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    try {
      return await handleInstanceStart(request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '启动实例失败'
      request.log.error({ err: error }, '启动实例时发生未处理异常')
      return businessError(message, request)
    }
  })

  async function handleInstanceStart(request: FastifyRequest): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceActionBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const id = body.data.id
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const runtimeError = await requireContainerRuntime(request)
    if (runtimeError) {
      return runtimeError
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    if (current.status === 'pending_install' || current.status === 'installing') {
      return businessError('实例正在安装中，请稍后重试启动', request)
    }
    if (isInstallJobActive(id) || isAnyInstallJobActive() || isSteamcmdAppUpdateBusy()) {
      return businessError('当前有实例正在安装或更新游戏文件（SteamCMD），请等待完成后再启动', request)
    }
    const installPath = normalizeInstallPath(current.installPath ?? undefined) || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: installPathError,
      })
      return businessError(installPathError, request)
    }
    const ensureDirError = prepareInstallPathForRuntime(installPath)
    if (ensureDirError) {
      const errorMessage = `安装目录创建失败: ${ensureDirError}`
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (!fs.existsSync(installPath)) {
      const errorMessage = '安装路径不存在，请重新执行实例安装'
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    let installPathStat: fs.Stats
    try {
      installPathStat = fs.statSync(installPath)
    }
    catch {
      const errorMessage = `安装路径不存在或不可访问: ${installPath}`
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (!installPathStat.isDirectory()) {
      const errorMessage = `安装路径不是目录: ${installPath}`
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    const steamcmdImageReady = await isSteamcmdImagePresent()
    const installReadiness = current.gameCode.trim() === DST_APP_ID
      ? diagnoseDstInstallReadiness(installPath)
      : {
        ready: false,
        code: 'missing_game_files' as const,
        message: '当前仅支持饥荒（343050）实例启动',
      }
    if (!installReadiness.ready) {
      const errorMessage = buildDstStartBlockedMessage(installReadiness, steamcmdImageReady, {
        installLogStatus: current.installLogStatus,
        instanceStatus: current.status,
        lastError: current.lastError,
      })
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    let gamePort = current.gamePort
    if (current.gameCode.trim() === DST_APP_ID) {
      const portResult = await resolveDstGamePortForStart({
        instanceId: id,
        nodeId: current.nodeId,
        gameCode: current.gameCode,
        installPath,
        gamePort: current.gamePort,
        autoAllocatePorts: body.data.autoAllocatePorts === true,
      })
      if (!portResult.ok) {
        if (portResult.kind === 'port_conflict') {
          return businessError(
            portResult.probe.userMessage,
            request,
            ErrorCode.INSTANCE_PORT_CONFLICT,
            {
              conflictingPorts: portResult.probe.conflictingPorts,
              suggestedGamePort: portResult.probe.suggestedGamePort,
              currentGamePort: portResult.probe.currentGamePort,
            },
          )
        }
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: portResult.message,
        })
        return businessError(portResult.message, request)
      }
      gamePort = portResult.gamePort
    }
    const layoutResult = current.gameCode.trim() === DST_APP_ID
      ? ensureDstLayout(installPath, {
        instanceName: current.name,
        gamePort,
      })
      : { ok: false, message: '当前仅支持饥荒（343050）实例启动' }
    if (!layoutResult.ok) {
      const layoutReadiness = diagnoseDstInstallReadiness(installPath)
      const errorMessage = buildDstStartBlockedMessage(
        layoutReadiness.ready ? installReadiness : layoutReadiness,
        steamcmdImageReady,
        {
          installLogStatus: current.installLogStatus,
          instanceStatus: current.status,
          lastError: current.lastError,
        },
      )
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (current.gameCode.trim() === DST_APP_ID) {
      try {
        await syncInstanceModFilesFromDb(id, installPath)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : '同步 Mod 配置失败'
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: message,
        })
        return businessError(message, request)
      }
    }
    const updateBlockMessage = await resolveStartBlockedByPendingUpdate(current)
    if (updateBlockMessage) {
      return businessError(updateBlockMessage, request)
    }
    if (await isInstanceContainerRunning(id)) {
      if (current.status !== 'running') {
        const ref = await resolveInstanceContainerRef(id)
        await updateGameInstanceRuntime(id, {
          status: 'running',
          containerId: ref?.id ?? current.containerId,
          runtimeStartedAt: current.runtimeStartedAt ?? new Date().toISOString(),
          lastError: null,
        })
      }
      return success({ isSuccess: true }, request)
    }
    if (current.status === 'running') {
      await updateGameInstanceRuntime(id, {
        status: 'stopped',
        containerId: null,
        runtimePid: null,
        runtimeStartedAt: null,
      })
    }
    await updateGameInstanceRuntime(id, {
      lastCommand: '正在准备 DST 运行镜像（若本地缺失将自动拉取）…',
      lastError: null,
    })
    const started = await startInstanceContainer(app, {
      instanceId: id,
      gameCode: current.gameCode,
      installPath,
      instanceName: current.name,
      gamePort,
    })
    if (!started.ok) {
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: started.message,
      })
      if (started.hostMemoryPressure) {
        return hostMemoryPressureError(started.hostMemoryPressure, request)
      }
      return businessError(started.message, request)
    }
    await updateGameInstanceRuntime(id, {
      status: 'running',
      containerId: started.ref.id,
      runtimePid: null,
      runtimeStartedAt: new Date().toISOString(),
      lastCommand: started.displayCommand,
      lastExitCode: null,
      lastError: null,
    })
    return success({ isSuccess: true }, request)
  }

  app.post('/app/instance/stop', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceActionBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const id = body.data.id
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    if (current.status === 'stopped') {
      return success({ isSuccess: true }, request)
    }
    const runtimeError = await requireContainerRuntime(request)
    if (runtimeError) {
      return runtimeError
    }
    if (current.status === 'pending_install' || current.status === 'installing') {
      await cancelInstallJob(id)
      app.log.info({ instanceId: id }, '实例安装已取消')
      return success({ isSuccess: true }, request)
    }
    try {
      app.log.info({ instanceId: id }, '实例停止命令已发送')
      await stopInstanceContainer(id)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '停止实例失败'
      app.log.error({
        instanceId: id,
        error: message,
      }, '实例停止失败')
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: message,
      })
      return businessError(message, request)
    }
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/restart', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceActionBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const id = body.data.id
    const { restartInstanceCore } = await import('./restart-instance-core.ts')
    return restartInstanceCore(app, request, id, {
      autoAllocatePorts: body.data.autoAllocatePorts === true,
    })
  })

  app.post('/app/instance/delete', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = instanceActionBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const id = body.data.id
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    const runtimeError = await requireContainerRuntime(request)
    if (runtimeError) {
      return runtimeError
    }
    if (current.status === 'pending_install' || current.status === 'installing' || isInstallJobActive(id)) {
      await cancelInstallJob(id)
    }
    if (current.status === 'running' || current.containerId) {
      try {
        app.log.info({ instanceId: id }, '删除实例前自动停止运行中的容器')
        await stopInstanceContainer(id)
        await removeInstanceContainer(id)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : '删除前停止实例失败'
        return businessError(message, request)
      }
    }
    else {
      await removeInstanceContainer(id)
    }
    clearInstallJobTracking(id)
    deleteInstallLogFile(getInstallLogsDirPath(), id)
    const installPath = normalizeInstallPath(current.installPath ?? undefined)
      || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    // 先删数据库记录，再删磁盘目录：目录清理失败时最多留下孤儿文件，
    // 不会出现"记录还在、游戏文件已没"的无法自洽状态。
    const deleted = await deleteGameInstanceById(id)
    if (!deleted) {
      return businessError('实例不存在', request)
    }
    if (fs.existsSync(installPath)) {
      try {
        fs.rmSync(installPath, {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 200,
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : '删除实例目录失败'
        app.log.warn({ instanceId: id, installPath, error: message }, '实例记录已删除，但实例目录清理失败，请手动处理')
      }
    }
    instanceConsoleLogStore.removeInstance(id)
    return success({ isSuccess: true }, request)
  })

  app.addHook('onReady', async () => {
    try {
      await reconcileOrphanedSteamcmdOnPanelReady(app)
      await reconcileInstanceRuntimeState(app)
    }
    catch (error) {
      app.log.warn({ error }, '实例运行时对齐跳过（运行时不可用或连接失败）')
    }
    scheduleInstanceUpdateChecks(app)
  })
}
