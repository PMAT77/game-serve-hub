import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { DbInstallLogStatus } from '../../shared/db/index'
import {
  createGameInstance,
  deleteGameInstanceById,
  findUserByToken,
  getGameInstanceById,
  getServerNodeById,
  getSystemSteamcmdConfig,
  listGameInstances,
  updateGameInstanceRuntime,
} from '../../shared/db/index'
import { loadServerConfig, resolveInstallLogsDir } from '../../shared/config'
import {
  deleteInstallLogFile,
  InstanceInstallLogWriter,
  readInstallLogContent,
} from '../../shared/instance-install/log-store'
import { runSteamcmdAppUpdateInContainer } from '../../infra/container'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { ensureDstLayout } from '../../infra/game-adapter/dst/cluster-config'
import {
  ensureContainerRuntimeReady,
  isInstanceContainerRunning,
  removeInstanceContainer,
  resolveDefaultInstanceInstallPath,
  startInstanceContainer,
  stopInstanceContainer,
} from './container-lifecycle'
import { businessError, success, unauthorized } from '../../shared/http/response'
import { registerInstanceMetricsRoute } from './metrics'
import type { InstanceCheckUpdatesResponse } from './update-check'
import { readLocalBuildId } from '../../shared/steam-update/build-id'
import {
  checkInstancesForUpdates,
  needsRemoteUpdatePrecheck,
  refreshInstanceUpdateStatus,
  refreshInstanceUpdateStatusAfterInstall,
  refreshStaleInstanceUpdateChecks,
  resolveSteamcmdCommandForUpdateCheck,
  scheduleInstanceUpdateChecks,
} from './update-check'

interface InstanceListQuery {
  nodeId?: string
  status?: 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'
  keyword?: string
}

interface CreateInstanceBody {
  nodeId?: string
  name?: string
  gameCode?: string
  installPath?: string
  configPath?: string
  queryPort?: number
  gamePort?: number
  rconPort?: number
}

interface InstanceActionBody {
  id?: string
}

interface InstallLogQuery {
  id?: string
}

interface InstallableGameItem {
  appId: string
  name: string
}

type InstallLogSource = 'install_log' | 'status_summary' | 'empty'

interface InstanceInstallJobInput {
  instanceId: string
  appId: string
  instanceName: string
  gamePort?: number | null
  installPath: string
  steamcmdCommand: string
  steamcmdCredentials?: { username: string, password: string }
}

interface InstallLogResponse {
  content: string
  status: 'success' | 'failed' | 'running' | 'unknown'
  updatedAt: string | null
  source: InstallLogSource
}

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
  },
]

const stoppingInstanceIds = new Set<string>()
const installingInstanceIds = new Set<string>()

function getInstallLogsDirPath() {
  return resolveInstallLogsDir(loadServerConfig().dbPath)
}

async function writeInstallLogMeta(
  instanceId: string,
  status: DbInstallLogStatus,
  installPercent?: number | null,
) {
  const updatedAt = new Date().toISOString()
  await updateGameInstanceRuntime(instanceId, {
    installLogStatus: status,
    installLogUpdatedAt: updatedAt,
    ...(typeof installPercent !== 'undefined' ? { installPercent } : {}),
  })
}

function mapDbInstallLogStatusToResponse(
  installLogStatus: DbInstallLogStatus | null,
  instanceStatus: string,
): InstallLogResponse['status'] {
  if (installLogStatus === 'running' || installLogStatus === 'success' || installLogStatus === 'failed') {
    return installLogStatus
  }
  if (instanceStatus === 'installing' || instanceStatus === 'pending_install') {
    return 'running'
  }
  if (instanceStatus === 'error') {
    return 'failed'
  }
  return 'unknown'
}

function startInstanceInstallJob(
  app: FastifyInstance,
  input: InstanceInstallJobInput,
): boolean {
  if (installingInstanceIds.has(input.instanceId)) {
    return false
  }
  installingInstanceIds.add(input.instanceId)
  const logWriter = new InstanceInstallLogWriter(getInstallLogsDirPath(), input.instanceId)
  logWriter.clear()
  void installInstanceFilesInBackground(app, input, logWriter)
    .finally(() => {
      installingInstanceIds.delete(input.instanceId)
    })
  return true
}

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return tokenHeader ?? ''
}

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const token = normalizeToken(request.headers.token)
  if (!token) {
    return undefined
  }
  return token
}

async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  const token = getTokenByRequest(request)
  if (!token) {
    return unauthorized(request)
  }
  const user = await findUserByToken(token)
  if (!user) {
    return unauthorized(request)
  }
}

function normalizeInstanceId(value: string | undefined) {
  return value?.trim() ?? ''
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

function getSteamcmdLoginCredentials(): {
  username: string
  password: string
} | undefined {
  const username = process.env.STEAMCMD_USERNAME?.trim() ?? ''
  const password = process.env.STEAMCMD_PASSWORD?.trim() ?? ''
  if (!username || !password) {
    return undefined
  }
  return {
    username,
    password,
  }
}

async function getDefaultSteamInstallPath(_gameCode: string, instanceId: string): Promise<string> {
  return resolveDefaultInstanceInstallPath(instanceId)
}

async function checkContainerInstallReady(): Promise<{ ok: boolean, message?: string }> {
  return ensureContainerRuntimeReady()
}

function ensureInstallPathDirectory(installPath: string): string | undefined {
  try {
    fs.mkdirSync(installPath, { recursive: true })
  }
  catch (error) {
    return error instanceof Error ? error.message : '创建安装目录失败'
  }
}

async function installInstanceFilesInBackground(
  app: FastifyInstance,
  input: InstanceInstallJobInput,
  logWriter: InstanceInstallLogWriter,
) {
  const updateProgress = async (line: string) => {
    logWriter.appendLine(line)
    const progressMatch = line.match(/\[\s*(\d+)%\]/)
    const progressPercent = progressMatch
      ? Math.min(100, Number(progressMatch[1]))
      : null
    const progressText = progressPercent !== null
      ? `安装进度 ${progressPercent}%`
      : line
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: progressText,
      lastError: null,
      installLogStatus: 'running',
      installLogUpdatedAt: new Date().toISOString(),
      ...(progressPercent !== null ? { installPercent: progressPercent } : {}),
    })
  }

  try {
    logWriter.appendLine('安装任务启动')
    await writeInstallLogMeta(input.instanceId, 'running', null)
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: '正在准备安装...',
      lastError: null,
      installPercent: null,
    })

    const anonymousResult = await runSteamcmdAppUpdateInContainer({
      hostInstallPath: input.installPath,
      appId: input.appId,
      loginArgs: ['+login', 'anonymous'],
      onLogLine: line => void updateProgress(line),
    })
    if (anonymousResult.ok) {
      logWriter.appendLine('安装完成（anonymous）')
      const startScriptResult = input.appId.trim() === DST_APP_ID
        ? ensureDstLayout(input.installPath, {
            instanceName: input.instanceName,
            gamePort: input.gamePort,
          })
        : { ok: false, message: '当前仅支持饥荒（343050）' }
      if (startScriptResult.ok) {
        logWriter.appendLine('启动脚本已生成')
      }
      else {
        logWriter.appendLine(`启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`)
      }
      await writeInstallLogMeta(input.instanceId, 'success', 100)
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'stopped',
        lastCommand: startScriptResult.ok
          ? '安装完成（anonymous），启动脚本已生成'
          : `安装完成（anonymous），启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`,
        lastError: startScriptResult.ok ? null : startScriptResult.message ?? null,
        installPercent: 100,
      })
      await refreshInstanceUpdateStatusAfterInstall(
        input.instanceId,
        input.installPath,
        input.appId,
        input.steamcmdCommand,
      )
      return
    }

    if (!input.steamcmdCredentials) {
      logWriter.appendLine(`安装失败（anonymous）：${anonymousResult.output}`)
      await writeInstallLogMeta(input.instanceId, 'failed', null)
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'error',
        lastCommand: null,
        lastError: `安装失败（anonymous）：${anonymousResult.output}`,
      })
      return
    }

    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: 'anonymous 失败，正在尝试账号登录重试...',
      lastError: null,
    })
    logWriter.appendLine('anonymous 失败，正在尝试账号登录重试...')

    const accountResult = await runSteamcmdAppUpdateInContainer({
      hostInstallPath: input.installPath,
      appId: input.appId,
      loginArgs: ['+login', input.steamcmdCredentials.username, input.steamcmdCredentials.password],
      onLogLine: line => void updateProgress(line),
    })
    if (accountResult.ok) {
      logWriter.appendLine('安装完成（account）')
      const startScriptResult = input.appId.trim() === DST_APP_ID
        ? ensureDstLayout(input.installPath, {
            instanceName: input.instanceName,
            gamePort: input.gamePort,
          })
        : { ok: false, message: '当前仅支持饥荒（343050）' }
      if (startScriptResult.ok) {
        logWriter.appendLine('启动脚本已生成')
      }
      else {
        logWriter.appendLine(`启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`)
      }
      await writeInstallLogMeta(input.instanceId, 'success', 100)
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'stopped',
        lastCommand: startScriptResult.ok
          ? '安装完成（account），启动脚本已生成'
          : `安装完成（account），启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`,
        lastError: startScriptResult.ok ? null : startScriptResult.message ?? null,
        installPercent: 100,
      })
      await refreshInstanceUpdateStatusAfterInstall(
        input.instanceId,
        input.installPath,
        input.appId,
        input.steamcmdCommand,
      )
      return
    }

    logWriter.appendLine(`安装失败。\n--- anonymous ---\n${anonymousResult.output}\n--- account ---\n${accountResult.output}`)
    await writeInstallLogMeta(input.instanceId, 'failed', null)
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'error',
      lastCommand: null,
      lastError: `安装失败。\n--- anonymous ---\n${anonymousResult.output}\n--- account ---\n${accountResult.output}`,
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '安装任务异常中断'
    logWriter.appendLine(message)
    await writeInstallLogMeta(input.instanceId, 'failed', null)
    app.log.error({
      instanceId: input.instanceId,
      installPath: input.installPath,
      message,
    }, '实例后台安装失败')
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'error',
      lastCommand: null,
      lastError: message,
    })
  }
}

function validateInstallPath(rawPath: string): string | undefined {
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
      continue
    }
    stoppingInstanceIds.delete(instance.id)
    await updateGameInstanceRuntime(instance.id, {
      status: 'stopped',
      containerId: null,
      runtimePid: null,
      runtimeStartedAt: null,
    })
    reconciled++
    app.log.info({ instanceId: instance.id }, '实例容器不存在，已同步状态为已停止')
  }
  return reconciled
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
  await reconcileStaleRunningInstances(app)
  const status = payload.status
  const instances = await listGameInstances({
    nodeId: payload.nodeId?.trim() || undefined,
    status: status && ['pending_install', 'running', 'stopped', 'installing', 'error'].includes(status)
      ? status
      : undefined,
    keyword: payload.keyword?.trim() || undefined,
  })
  const runtimeReady = await checkContainerInstallReady()
  if (runtimeReady.ok) {
    const steamcmdCommand = await resolveSteamcmdCommandForUpdateCheck()
    void refreshStaleInstanceUpdateChecks(app, instances, steamcmdCommand)
  }
  return success(instances, request)
}

/**
 * instance 模块注册入口
 * 负责游戏实例生命周期管理（创建、启动、停止、重启、删除）。
 */
export function registerInstanceModule(app: FastifyInstance) {
  registerInstanceMetricsRoute(app)
  app.post('/app/instance/list', async request => handleListInstances(app, request, (request.body ?? {}) as InstanceListQuery))

  app.get('/app/instance/games', async (request): Promise<ApiSuccessResponse<InstallableGameItem[]> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    return success(INSTALLABLE_GAMES, request)
  })

  app.get('/app/instance/install-log', async (request): Promise<ApiSuccessResponse<InstallLogResponse> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = (request.query ?? {}) as InstallLogQuery
    const id = normalizeInstanceId(query.id)
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const instance = await getGameInstanceById(id)
    if (!instance) {
      return businessError('实例不存在', request)
    }
    const fileContent = readInstallLogContent(getInstallLogsDirPath(), id)
    if (fileContent) {
      return success<InstallLogResponse>({
        content: fileContent,
        status: mapDbInstallLogStatusToResponse(instance.installLogStatus, instance.status),
        updatedAt: instance.installLogUpdatedAt ?? instance.updatedAt,
        source: 'install_log',
      }, request)
    }
    if (installingInstanceIds.has(id)) {
      return success<InstallLogResponse>({
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
      return success<InstallLogResponse>({
        content: '暂无 SteamCMD 安装输出。',
        status: 'unknown',
        updatedAt: instance.updatedAt,
        source: 'empty',
      }, request)
    }
    return success<InstallLogResponse>({
      content: [
        '【最近状态摘要，非完整 SteamCMD 输出】',
        '',
        summaryLines,
      ].join('\n'),
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
    const body = (request.body ?? {}) as CreateInstanceBody
    const nodeId = body.nodeId?.trim() ?? ''
    const name = body.name?.trim() ?? ''
    const gameCode = body.gameCode?.trim() ?? ''
    const manualInstallPath = normalizeInstallPath(body.installPath)
    if (!nodeId) {
      return businessError('请选择节点', request)
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
      return businessError(runtimeReady.message ?? '容器运行时未就绪', request)
    }
    const instanceId = randomUUID()
    const installPath = manualInstallPath || await getDefaultSteamInstallPath(gameCode, instanceId)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    const node = await getServerNodeById(nodeId)
    if (!node) {
      return businessError('节点不存在', request)
    }
    const ensureDirError = ensureInstallPathDirectory(installPath)
    if (ensureDirError) {
      return businessError(`安装目录创建失败: ${ensureDirError}`, request)
    }
    if (!manualInstallPath) {
      app.log.info({
        nodeId,
        gameCode: selectedGame.appId,
        installPath,
      }, '创建实例未填写安装目录，已回退到默认 SteamCMD 路径')
    }
    app.log.info({
      instanceId,
      gameCode,
      installPath,
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
      gamePort: normalizePort(body.gamePort),
      rconPort: normalizePort(body.rconPort),
      lastExitCode: null,
      lastCommand: '等待安装任务启动',
      lastError: null,
    })
    const started = startInstanceInstallJob(app, {
      instanceId,
      appId: gameCode,
      instanceName: name,
      gamePort: normalizePort(body.gamePort),
      installPath,
      steamcmdCommand,
      steamcmdCredentials,
    })
    if (!started) {
      return businessError('该实例已有安装任务进行中', request)
    }
    return success(instance, request)
  })

  app.post('/app/instance/check-updates', async (request): Promise<ApiSuccessResponse<InstanceCheckUpdatesResponse> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as { ids?: string[] }
    const steamcmdCommand = await resolveSteamcmdCommandForUpdateCheck()
    const runtimeReady = await checkContainerInstallReady()
    if (!runtimeReady.ok) {
      return businessError(runtimeReady.message ?? '容器运行时未就绪，无法检查更新', request)
    }
    const instanceIds = Array.isArray(body.ids)
      ? body.ids.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
      : undefined
    const result = await checkInstancesForUpdates({
      steamcmdCommand,
      instanceIds,
      force: true,
    })
    return success(result, request)
  })

  app.post('/app/instance/update', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
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
    if (current.status === 'running') {
      return businessError('请先停止实例后再更新服务端', request)
    }
    if (current.status === 'pending_install' || current.status === 'installing') {
      return businessError('实例正在安装中，请稍后再试', request)
    }
    if (installingInstanceIds.has(id)) {
      return businessError('该实例已有安装任务进行中', request)
    }
    const installPath = normalizeInstallPath(current.installPath ?? undefined)
      || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    const ensureDirError = ensureInstallPathDirectory(installPath)
    if (ensureDirError) {
      return businessError(`安装目录创建失败: ${ensureDirError}`, request)
    }
    const steamcmdCredentials = getSteamcmdLoginCredentials()
    const steamcmdConfig = await getSystemSteamcmdConfig()
    const steamcmdCommand = steamcmdConfig?.steamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
    const runtimeReady = await checkContainerInstallReady()
    if (!runtimeReady.ok) {
      return businessError(runtimeReady.message ?? '容器运行时未就绪', request)
    }
    const localBuildId = readLocalBuildId(installPath, current.gameCode)
    if (
      !current.updateAvailable
      && localBuildId
      && current.remoteBuildId
      && localBuildId === current.remoteBuildId
    ) {
      return businessError(
        `当前已是最新版本（Build ${localBuildId}），无需更新`,
        request,
      )
    }
    if (needsRemoteUpdatePrecheck(current, localBuildId)) {
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
    const started = startInstanceInstallJob(app, {
      instanceId: id,
      appId: current.gameCode,
      instanceName: current.name,
      gamePort: current.gamePort,
      installPath,
      steamcmdCommand,
      steamcmdCredentials,
    })
    if (!started) {
      return businessError('该实例已有安装任务进行中', request)
    }
    await updateGameInstanceRuntime(id, {
      status: 'installing',
      lastCommand: '正在准备更新服务端...',
      lastError: null,
      installPercent: null,
    })
    app.log.info({
      instanceId: id,
      gameCode: current.gameCode,
      installPath,
    }, '实例开始执行 SteamCMD 手动更新')
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/start', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
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
    if (current.status === 'pending_install' || current.status === 'installing') {
      return businessError('实例正在安装中，请稍后重试启动', request)
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
    const ensureDirError = ensureInstallPathDirectory(installPath)
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
    const layoutResult = current.gameCode.trim() === DST_APP_ID
      ? ensureDstLayout(installPath, {
          instanceName: current.name,
          gamePort: current.gamePort,
        })
      : { ok: false, message: '当前仅支持饥荒（343050）容器化启动' }
    if (!layoutResult.ok) {
      const errorMessage = layoutResult.message ?? '实例安装目录未就绪'
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (await isInstanceContainerRunning(id)) {
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
    stoppingInstanceIds.delete(id)
    const started = await startInstanceContainer(app, {
      instanceId: id,
      gameCode: current.gameCode,
      installPath,
      instanceName: current.name,
      gamePort: current.gamePort,
    })
    if (!started.ok) {
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: started.message,
      })
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
  })

  app.post('/app/instance/stop', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
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
    try {
      stoppingInstanceIds.add(id)
      app.log.info({ instanceId: id }, '实例停止命令已发送')
      await stopInstanceContainer(id)
    }
    catch (error) {
      stoppingInstanceIds.delete(id)
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
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
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
    if (current.status === 'running' || current.containerId) {
      stoppingInstanceIds.add(id)
      try {
        await stopInstanceContainer(id)
      }
      catch (error) {
        stoppingInstanceIds.delete(id)
        const message = error instanceof Error ? error.message : '重启时停止实例失败'
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: message,
        })
        return businessError(message, request)
      }
    }
    return app.inject({
      method: 'POST',
      url: '/app/instance/start',
      headers: {
        token: normalizeToken(request.headers.token),
      },
      payload: {
        id,
      },
    }).then((response) => {
      if (response.statusCode >= 400) {
        return businessError('实例重启失败', request)
      }
      const payload = JSON.parse(response.body) as ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse
      if ('error' in payload && payload.error) {
        return businessError(payload.error, request)
      }
      return success({ isSuccess: true }, request)
    })
  })

  app.post('/app/instance/delete', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
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
    if (current.status === 'running' || current.containerId) {
      stoppingInstanceIds.add(id)
      try {
        app.log.info({ instanceId: id }, '删除实例前自动停止运行中的容器')
        await stopInstanceContainer(id)
        await removeInstanceContainer(id)
      }
      catch (error) {
        stoppingInstanceIds.delete(id)
        const message = error instanceof Error ? error.message : '删除前停止实例失败'
        return businessError(message, request)
      }
    }
    else {
      await removeInstanceContainer(id)
    }
    installingInstanceIds.delete(id)
    deleteInstallLogFile(getInstallLogsDirPath(), id)
    stoppingInstanceIds.delete(id)
    const installPath = normalizeInstallPath(current.installPath ?? undefined)
      || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
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
        return businessError(`删除实例目录失败: ${message}`, request)
      }
    }
    const deleted = await deleteGameInstanceById(id)
    if (!deleted) {
      return businessError('实例不存在', request)
    }
    return success({ isSuccess: true }, request)
  })

  app.addHook('onReady', async () => {
    const reconciled = await reconcileStaleRunningInstances(app)
    if (reconciled > 0) {
      app.log.info({ reconciled }, '已校正因服务重启而残留的实例运行状态')
    }
    scheduleInstanceUpdateChecks(app)
  })
}
