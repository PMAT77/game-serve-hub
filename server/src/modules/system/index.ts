import type { FastifyInstance } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  DirectoryItem,
  NetworkConfigRequest,
  PanelSettingsRequest,
  SteamcmdConfigRequest,
} from '../../../../shared/contracts/system'
import {
  directoryListQuerySchema,
  directorySearchQuerySchema,
  networkConfigRequestSchema,
  panelSettingsRequestSchema,
  panelUpdateApplyRequestSchema,
  steamcmdConfigRequestSchema,
} from '../../../../shared/contracts/system'
import type { DbSystemSteamcmdConfig } from '../../shared/db/index'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { buildHostMemoryGuidance } from '../../../../shared/host-memory-guidance.ts'
import {
  readHostMemoryAvailableMb,
  readHostMemoryTotalMb,
} from '../../infra/container/host-resource-guard.ts'
import {
  isAllowedBrowsePath,
  isReadableDirectoryPath,
  listChildEntries,
  listRootDirectories,
  normalizeDirectoryPath,
  searchFilesystemEntries,
} from '../../infra/filesystem-browse'
import {
  ensureSteamcmdImage,
  isGameDstImagePresent,
  pullGameDstImage,
} from '../../infra/container'
import { resolveDockerStatus } from '../../infra/docker'
import {
  isSteamcmdRuntimeReady,
  resolveRuntimeStatus,
} from '../../infra/runtime'
import { buildSteamcmdImageReadyMessage } from '../../infra/steamcmd'
import { runSteamcmdDiagnostics } from '../../infra/container/steamcmd-diagnostics'
import { loadServerConfig } from '../../shared/config'
import { loadSteamcmdRuntimeConfig } from '../../shared/config/steamcmd'
import { getServerContainerConfig } from '../../shared/config/container'
import {
  getSystemNetworkConfig,
  getSystemPanelSettings,
  getSystemSteamcmdConfig,
  saveSystemNetworkConfig,
  saveSystemPanelSettings,
  saveSystemSteamcmdConfig,
} from '../../shared/db/index'
import { SYSTEM_MANAGE_PERMISSION, SYSTEM_READ_PERMISSION } from '../../shared/menu-routes'
import { businessError, success } from '../../shared/http/response'
import { requirePermission } from './auth'
import {
  getDefaultNetworkConfig,
  getDefaultPanelSettings,
  getDefaultSteamcmdConfig,

  normalizeSteamcmdConfigBody,

  validateInstallRootPath,
} from './defaults'
import {
  clampPercent,
  ensureNetworkSamplerStarted,
  getCachedDockerStatusForSystem,
  getCachedNetworkRealtime,
  getCachedPanelVersion,
  getCachedWindowsQueueMetrics,
  getCpuUsageRate,
  getDiskUsage,
  warmSystemMetricsCaches,
} from './metrics'
import {
  applyPanelUpdate,
  getCachedPanelUpdateStatus,
  refreshPanelUpdateStatus,
  schedulePanelUpdateChecks,
} from './panel-update'
import { resolveActualPanelPortFromRequest } from './panel-port'
import { syncDevComposeWebPort } from './dev-compose-env'
import { registerDatabaseBackupRoutes } from './db-backup-routes'

/**
 * system 模块注册入口
 */
export function registerSystemModule(app: FastifyInstance) {
  setImmediate(warmSystemMetricsCaches)

  app.addHook('onReady', async () => {
    schedulePanelUpdateChecks(app)
  })

  app.get('/app/system/settings', async (request): Promise<ApiSuccessResponse<ReturnType<typeof getDefaultPanelSettings> & {
    apiPort: number
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }
    const config = loadServerConfig()
    const settings = await getSystemPanelSettings() ?? getDefaultPanelSettings()
    const actualPanelPort = resolveActualPanelPortFromRequest(config.port, request)
    return success({
      ...settings,
      apiPort: actualPanelPort,
    }, request)
  })

  app.post('/app/system/settings', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedBody = panelSettingsRequestSchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    const body: PanelSettingsRequest = parsedBody.data
    const panelPort = body.panelPort ?? getDefaultPanelSettings().panelPort
    const theme = body.theme ?? 'system'
    const autoUpdate = body.autoUpdate ?? true
    const checkUpdateBeforeStart = body.checkUpdateBeforeStart ?? false
    const updateCheckIntervalHours = body.updateCheckIntervalHours ?? 3
    if (!Number.isInteger(panelPort) || panelPort <= 0 || panelPort > 65535) {
      return businessError('面板端口不合法', request)
    }
    if (!Number.isInteger(updateCheckIntervalHours) || updateCheckIntervalHours < 1 || updateCheckIntervalHours > 168) {
      return businessError('更新检查间隔应为 1-168 小时', request)
    }
    if (!['light', 'dark', 'system'].includes(theme)) {
      return businessError('主题配置不合法', request)
    }
    await saveSystemPanelSettings({
      panelPort,
      theme,
      autoUpdate,
      checkUpdateBeforeStart,
      updateCheckIntervalHours,
    })
    try {
      syncDevComposeWebPort(panelPort)
    }
    catch (error) {
      app.log.warn({ error }, '同步开发环境前端端口到 panel.env 失败')
    }
    return success({
      isSuccess: true,
    }, request)
  })

  app.get('/app/system/filesystem/directories', async (request): Promise<ApiSuccessResponse<DirectoryItem[]> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedQuery = directoryListQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      return businessError('请求参数无效', request)
    }
    const query = parsedQuery.data
    const rawPath = query.path?.trim()
    if (!rawPath) {
      return success(listRootDirectories(), request)
    }
    if (!path.isAbsolute(rawPath)) {
      return businessError('目录路径必须是绝对路径', request)
    }
    if (/[\0`$;&|]/.test(rawPath)) {
      return businessError('目录路径包含危险字符', request)
    }
    const normalizedPath = normalizeDirectoryPath(rawPath)
    if (!isAllowedBrowsePath(normalizedPath)) {
      return businessError('目录路径不在允许访问范围内', request)
    }
    if (!isReadableDirectoryPath(normalizedPath)) {
      return businessError('目录不存在或不可访问', request)
    }
    return success(listChildEntries(normalizedPath), request)
  })

  app.get('/app/system/filesystem/search', async (request): Promise<ApiSuccessResponse<DirectoryItem[]> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedQuery = directorySearchQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      return businessError('请求参数无效', request)
    }
    const query = parsedQuery.data
    const keyword = query.keyword?.trim() ?? ''
    if (!keyword) {
      return success([], request)
    }
    if (keyword.length > 64) {
      return businessError('搜索关键词过长，请控制在 64 字符以内', request)
    }
    if (/[\0`$;&|]/.test(keyword)) {
      return businessError('搜索关键词包含危险字符', request)
    }
    return success(searchFilesystemEntries(keyword), request)
  })

  app.get('/app/system/steamcmd/config', async (request): Promise<ApiSuccessResponse<DbSystemSteamcmdConfig & {
    runtimeMode: 'docker' | 'native'
    runtimeStatus: 'running' | 'stopped'
    steamcmdImage: string
    gameDstImage: string
    isDockerAvailable: boolean
    isSteamcmdInstalled: boolean
    isGameDstImageInstalled: boolean
    detectedSteamcmdPath: string
    downloadRegion: string
    networkMode: string
    installMaxAttempts: number
    httpProxyConfigured: boolean
    httpsProxyConfigured: boolean
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }
    const containerConfig = getServerContainerConfig()
    const config = await getSystemSteamcmdConfig() ?? getDefaultSteamcmdConfig()
    const installRoot = containerConfig.instancesRoot
    const runtimeStatus = await resolveRuntimeStatus()
    const dockerStatus = containerConfig.runtimeMode === 'docker'
      ? await resolveDockerStatus()
      : 'stopped'
    const isDockerAvailable = dockerStatus === 'running'
    const isSteamcmdInstalled = runtimeStatus === 'running' && await isSteamcmdRuntimeReady()
    const isGameDstImageInstalled = containerConfig.runtimeMode === 'native'
      ? runtimeStatus === 'running'
      : isDockerAvailable && await isGameDstImagePresent()
    const steamcmdImage = containerConfig.steamcmdImage
    const gameDstImage = containerConfig.gameDstImage
    const steamcmdRuntime = loadSteamcmdRuntimeConfig()
    return success({
      ...config,
      steamcmdPath: containerConfig.runtimeMode === 'native'
        ? containerConfig.nativeSteamcmdPath
        : steamcmdImage,
      installRoot,
      runtimeMode: containerConfig.runtimeMode,
      runtimeStatus,
      steamcmdImage,
      gameDstImage,
      isDockerAvailable,
      isSteamcmdInstalled,
      isGameDstImageInstalled,
      detectedSteamcmdPath: isSteamcmdInstalled
        ? (containerConfig.runtimeMode === 'native' ? containerConfig.nativeSteamcmdPath : steamcmdImage)
        : '',
      downloadRegion: steamcmdRuntime.downloadRegion,
      networkMode: steamcmdRuntime.networkMode,
      installMaxAttempts: steamcmdRuntime.installMaxAttempts,
      httpProxyConfigured: Boolean(steamcmdRuntime.httpProxy),
      httpsProxyConfigured: Boolean(steamcmdRuntime.httpsProxy),
    }, request)
  })

  app.get('/app/system/steamcmd/diagnostics', async (request): Promise<ApiSuccessResponse<Awaited<ReturnType<typeof runSteamcmdDiagnostics>>> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }
    const result = await runSteamcmdDiagnostics()
    return success(result, request)
  })

  app.post('/app/system/steamcmd/config', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedBody = steamcmdConfigRequestSchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    const body: SteamcmdConfigRequest = parsedBody.data
    const containerConfig = getServerContainerConfig()
    const config = {
      ...normalizeSteamcmdConfigBody(body),
      steamcmdPath: containerConfig.runtimeMode === 'native'
        ? containerConfig.nativeSteamcmdPath
        : containerConfig.steamcmdImage,
      installRoot: containerConfig.instancesRoot,
    }
    const installRootError = validateInstallRootPath(config.installRoot)
    if (installRootError) {
      return businessError(installRootError, request)
    }
    try {
      fs.mkdirSync(config.installRoot, { recursive: true })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '创建实例安装根目录失败'
      return businessError(message, request)
    }
    await saveSystemSteamcmdConfig(config)
    app.log.info({
      steamcmdPath: config.steamcmdPath,
      installRoot: config.installRoot,
    }, 'SteamCMD 配置已保存')
    return success({
      isSuccess: true,
    }, request)
  })

  app.post('/app/system/steamcmd/install', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
    message: string
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const runtimeMode = getServerContainerConfig().runtimeMode
    if ((await resolveRuntimeStatus(true)) !== 'running') {
      return businessError(
        runtimeMode === 'native'
          ? '无法连接 systemd 用户服务管理器，请检查 gsh 用户 linger 和 user bus'
          : '无法连接 Docker，请确认面板已挂载 docker.sock（或 Windows 下 Docker Desktop 已启动）',
        request,
      )
    }
    const pullResult = await ensureSteamcmdImage()
    if (!pullResult.ok) {
      app.log.error({ error: pullResult.error }, 'SteamCMD 镜像拉取失败')
      return businessError(pullResult.error, request)
    }
    const runtimeConfig = getServerContainerConfig()
    const message = runtimeConfig.runtimeMode === 'native'
      ? `Native SteamCMD 已就绪：${runtimeConfig.nativeSteamcmdPath}`
      : buildSteamcmdImageReadyMessage(runtimeConfig.steamcmdImage)
    app.log.info({ runtimeMode, steamcmdPath: runtimeConfig.nativeSteamcmdPath, steamcmdImage: runtimeConfig.steamcmdImage }, 'SteamCMD 运行时已就绪')
    return success({
      isSuccess: true,
      message,
    }, request)
  })

  app.post('/app/system/game-dst/install', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
    message: string
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const runtimeConfig = getServerContainerConfig()
    if ((await resolveRuntimeStatus(true)) !== 'running') {
      return businessError(
        runtimeConfig.runtimeMode === 'native'
          ? '无法连接 systemd 用户服务管理器'
          : '无法连接 Docker，请确认面板已挂载 docker.sock（或 Windows 下 Docker Desktop 已启动）',
        request,
      )
    }
    if (runtimeConfig.runtimeMode === 'native') {
      return success({
        isSuccess: true,
        message: 'Native 模式直接运行实例目录中的 DST 服务端，不需要运行镜像。',
      }, request)
    }
    const pullResult = await pullGameDstImage()
    if (!pullResult.ok) {
      app.log.error({ error: pullResult.error }, 'DST 运行镜像拉取失败')
      return businessError(pullResult.error, request)
    }
    const { gameDstImage } = getServerContainerConfig()
    const message = `DST 运行镜像已就绪：${gameDstImage}。现在可以启动已安装完成的实例。`
    app.log.info({ gameDstImage }, 'DST 运行镜像已就绪')
    return success({
      isSuccess: true,
      message,
    }, request)
  })

  app.get('/app/system/panel-update/status', async (request): Promise<ApiSuccessResponse<ReturnType<typeof getCachedPanelUpdateStatus>> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }
    return success(getCachedPanelUpdateStatus(), request)
  })

  app.post('/app/system/panel-update/check', async (request): Promise<ApiSuccessResponse<ReturnType<typeof getCachedPanelUpdateStatus>> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    if (loadServerConfig().runtimeMode === 'docker' && (await resolveDockerStatus(true)) !== 'running') {
      return businessError('无法连接 Docker，暂不能检查 Hub 镜像更新', request)
    }
    const status = await refreshPanelUpdateStatus()
    return success(status, request)
  })

  app.post('/app/system/panel-update/apply', async (request): Promise<ApiSuccessResponse<{
    status: 'updating' | 'completed'
    message: string
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    if (loadServerConfig().runtimeMode === 'native') {
      return businessError('裸机模式请使用版本状态中提供的安装命令原地升级，以保留校验和自动回滚能力。', request)
    }
    if ((await resolveDockerStatus(true)) !== 'running') {
      return businessError('无法连接 Docker，暂不能更新 Hub 镜像', request)
    }
    const parsedBody = panelUpdateApplyRequestSchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    try {
      const result = await applyPanelUpdate()
      return success(result, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return businessError(message, request)
    }
  })

  app.get('/app/system/info', async (request): Promise<ApiSuccessResponse<{
    cpu: {
      cores: number
      model: string
      usageRate: number
    }
    load: {
      oneMinute: number
      fiveMinutes: number
      fifteenMinutes: number
      usageRate: number
      isSynthetic: boolean
      cpuQueueLength: number | null
      diskQueueLength: number | null
    }
    memory: {
      totalGb: number
      usedGb: number
      freeGb: number
      usageRate: number
      availableGb: number | null
    }
    memoryGuidance: import('../../../../shared/contracts/host-memory-guidance.ts').HostMemoryGuidancePayload
    disk: {
      totalGb: number
      usedGb: number
      freeGb: number
    }
    os: {
      platform: string
      release: string
      arch: string
      hostname: string
    }
    panelVersion: string
    runtimeMode: 'docker' | 'native'
    runtimeStatus: 'running' | 'stopped'
    dockerStatus: 'running' | 'stopped'
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }
    const cpuInfo = os.cpus()
    const cpuCores = Math.max(1, cpuInfo.length)
    const cpuUsageRate = getCpuUsageRate()
    const loadAvg = os.loadavg()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memoryUsageRate = Number(((usedMem / totalMem) * 100).toFixed(2))
    const hostTotalMb = readHostMemoryTotalMb()
    const hostAvailableMb = readHostMemoryAvailableMb()
    const memoryGuidance = buildHostMemoryGuidance({
      totalMb: hostTotalMb ?? Math.round(totalMem / 1024 / 1024),
      availableMb: hostAvailableMb,
    })
    const availableGb = hostAvailableMb !== null
      ? Number((hostAvailableMb / 1024).toFixed(2))
      : null
    const diskUsage = getDiskUsage()
    const diskUsageRate = diskUsage.totalGb > 0
      ? clampPercent((diskUsage.usedGb / diskUsage.totalGb) * 100)
      : 0

    const load = process.platform === 'win32'
      ? (() => {
        const queueMetrics = getCachedWindowsQueueMetrics()
        const cpuQueueNorm = queueMetrics.cpuQueueLength !== null
          ? clampPercent((queueMetrics.cpuQueueLength / cpuCores) * 100)
          : cpuUsageRate
        const diskQueueNorm = queueMetrics.diskQueueLength !== null
          ? clampPercent((queueMetrics.diskQueueLength / 2) * 100)
          : diskUsageRate
        const pressureRate = Number(clampPercent(
          (cpuQueueNorm * 0.55)
          + (diskQueueNorm * 0.30)
          + (memoryUsageRate * 0.15),
        ).toFixed(2))
        const equivalentOneMinute = Number(((pressureRate / 100) * cpuCores).toFixed(2))
        return {
          oneMinute: equivalentOneMinute,
          fiveMinutes: equivalentOneMinute,
          fifteenMinutes: equivalentOneMinute,
          usageRate: pressureRate,
          isSynthetic: true,
          cpuQueueLength: queueMetrics.cpuQueueLength,
          diskQueueLength: queueMetrics.diskQueueLength,
        }
      })()
      : {
        oneMinute: Number(loadAvg[0].toFixed(2)),
        fiveMinutes: Number(loadAvg[1].toFixed(2)),
        fifteenMinutes: Number(loadAvg[2].toFixed(2)),
        usageRate: Number(clampPercent((loadAvg[0] / cpuCores) * 100).toFixed(2)),
        isSynthetic: false,
        cpuQueueLength: null,
        diskQueueLength: null,
      }

    return success({
      cpu: {
        cores: cpuCores,
        model: cpuInfo[0]?.model ?? 'unknown',
        usageRate: cpuUsageRate,
      },
      load,
      memory: {
        totalGb: Number((totalMem / 1024 / 1024 / 1024).toFixed(2)),
        usedGb: Number((usedMem / 1024 / 1024 / 1024).toFixed(2)),
        freeGb: Number((freeMem / 1024 / 1024 / 1024).toFixed(2)),
        usageRate: memoryUsageRate,
        availableGb,
      },
      memoryGuidance,
      disk: diskUsage,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
      },
      panelVersion: getCachedPanelVersion(),
      runtimeMode: loadServerConfig().runtimeMode,
      runtimeStatus: await resolveRuntimeStatus(),
      dockerStatus: loadServerConfig().runtimeMode === 'docker'
        ? getCachedDockerStatusForSystem()
        : 'stopped',
    }, request)
  })

  app.get('/app/system/network/realtime', async (request): Promise<ApiSuccessResponse<{
    timestamp: number
    interfaces: Array<{
      name: string
      upBps: number
      downBps: number
      totalSentBytes: number
      totalReceivedBytes: number
    }>
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }

    ensureNetworkSamplerStarted()
    return success(getCachedNetworkRealtime(), request)
  })

  app.get('/app/system/network/config', async (request): Promise<ApiSuccessResponse<ReturnType<typeof getDefaultNetworkConfig>> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }

    const config = await getSystemNetworkConfig()
    return success(config ?? getDefaultNetworkConfig(), request)
  })

  app.post('/app/system/network/config', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }

    const parsedBody = networkConfigRequestSchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    const body: NetworkConfigRequest = parsedBody.data
    const networkConfig = {
      mode: body.mode ?? 'bootstrap_pending',
      httpPort: body.httpPort ?? 80,
      domain: body.domain ?? '',
      tls: {
        enabled: body.tls?.enabled ?? false,
        provider: body.tls?.provider ?? 'none',
      },
    }
    if (!Number.isInteger(networkConfig.httpPort) || networkConfig.httpPort <= 0 || networkConfig.httpPort > 65535) {
      return businessError('端口号不合法', request)
    }
    await saveSystemNetworkConfig(networkConfig)
    return success({
      isSuccess: true,
    }, request)
  })

  app.post('/app/system/network/validate', async (request): Promise<ApiSuccessResponse<{
    isValid: boolean
    message: string
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_READ_PERMISSION)
    if (authError) {
      return authError
    }

    const parsedBody = networkConfigRequestSchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      return success({
        isValid: false,
        message: '请求参数无效',
      }, request)
    }
    const body: NetworkConfigRequest = parsedBody.data
    const httpPort = body.httpPort ?? 80
    if (!Number.isInteger(httpPort) || httpPort <= 0 || httpPort > 65535) {
      return success({
        isValid: false,
        message: '端口号不合法',
      }, request)
    }
    return success({
      isValid: true,
      message: '配置校验通过',
    }, request)
  })

  app.post('/app/system/network/apply', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
    message: string
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, SYSTEM_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }

    const config = await getSystemNetworkConfig()
    if (!config) {
      return businessError('请先保存网络配置', request)
    }

    return success({
      isSuccess: true,
      message: '配置已受理，等待网关编排模块接入',
    }, request)
  })

  registerDatabaseBackupRoutes(app)
}
