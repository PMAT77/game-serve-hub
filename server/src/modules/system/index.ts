import type { FastifyInstance } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { DirectoryItem } from '../../infra/filesystem-browse'
import type { DbSystemSteamcmdConfig } from '../../shared/db/index'
import type { NetworkConfigBody, PanelSettingsBody, SteamcmdConfigBody } from './defaults'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  isAllowedBrowsePath,
  isReadableDirectoryPath,
  listChildEntries,
  listRootDirectories,
  normalizeDirectoryPath,
  searchFilesystemEntries,
} from '../../infra/filesystem-browse'
import { resolveEffectiveInstallRoot, resolveSteamcmdPath, runSteamcmdInstallCommand } from '../../infra/steamcmd'
import {
  getSystemNetworkConfig,
  getSystemPanelSettings,
  getSystemSteamcmdConfig,
  saveSystemNetworkConfig,
  saveSystemPanelSettings,
  saveSystemSteamcmdConfig,
} from '../../shared/db/index'
import { businessError, success } from '../../shared/http/response'
import { verifyAuthorized } from './auth'
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

interface DirectoryListQuery {
  path?: string
}

interface DirectorySearchQuery {
  keyword?: string
}

/**
 * system 模块注册入口
 */
export function registerSystemModule(app: FastifyInstance) {
  setImmediate(warmSystemMetricsCaches)

  app.get('/app/system/settings', async (request): Promise<ApiSuccessResponse<ReturnType<typeof getDefaultPanelSettings>> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const settings = await getSystemPanelSettings()
    return success(settings ?? getDefaultPanelSettings(), request)
  })

  app.post('/app/system/settings', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as PanelSettingsBody
    const panelPort = body.panelPort ?? 80
    const theme = body.theme ?? 'system'
    const autoUpdate = body.autoUpdate ?? true
    if (!Number.isInteger(panelPort) || panelPort <= 0 || panelPort > 65535) {
      return businessError('面板端口不合法', request)
    }
    if (!['light', 'dark', 'system'].includes(theme)) {
      return businessError('主题配置不合法', request)
    }
    await saveSystemPanelSettings({
      panelPort,
      theme,
      autoUpdate,
    })
    return success({
      isSuccess: true,
    }, request)
  })

  app.get('/app/system/filesystem/directories', async (request): Promise<ApiSuccessResponse<DirectoryItem[]> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = (request.query ?? {}) as DirectoryListQuery
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
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = (request.query ?? {}) as DirectorySearchQuery
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
    isSteamcmdInstalled: boolean
    detectedSteamcmdPath: string
  }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const config = await getSystemSteamcmdConfig() ?? getDefaultSteamcmdConfig()
    const detectedSteamcmdPath = resolveSteamcmdPath(config.steamcmdPath)
    const steamcmdCommandForRoot = detectedSteamcmdPath || config.steamcmdPath
    const installRoot = resolveEffectiveInstallRoot(config.installRoot, steamcmdCommandForRoot)
    return success({
      ...config,
      installRoot,
      isSteamcmdInstalled: Boolean(detectedSteamcmdPath),
      detectedSteamcmdPath,
    }, request)
  })

  app.post('/app/system/steamcmd/config', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as SteamcmdConfigBody
    const config = normalizeSteamcmdConfigBody(body)
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
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const result = runSteamcmdInstallCommand()
    if (!result.ok) {
      app.log.error({
        message: result.message,
      }, 'SteamCMD 自动安装失败')
      return businessError(result.message, request)
    }
    app.log.info({
      message: result.message,
    }, 'SteamCMD 自动安装成功')
    return success({
      isSuccess: true,
      message: result.message,
    }, request)
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
    }
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
    dockerStatus: 'running' | 'stopped'
  }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
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
      },
      disk: diskUsage,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
      },
      panelVersion: getCachedPanelVersion(),
      dockerStatus: getCachedDockerStatusForSystem(),
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
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }

    ensureNetworkSamplerStarted()
    return success(getCachedNetworkRealtime(), request)
  })

  app.get('/app/system/network/config', async (request): Promise<ApiSuccessResponse<ReturnType<typeof getDefaultNetworkConfig>> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }

    const config = await getSystemNetworkConfig()
    return success(config ?? getDefaultNetworkConfig(), request)
  })

  app.post('/app/system/network/config', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }

    const body = (request.body ?? {}) as NetworkConfigBody
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
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }

    const body = (request.body ?? {}) as NetworkConfigBody
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
    const authError = await verifyAuthorized(request)
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
}
