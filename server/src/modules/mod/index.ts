import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  ModDeleteResult,
  ModInstallJobDto,
  ModInstallStatus,
  ModItemDto,
  ModListDto,
  ModMutationResult,
  ModReorderResult,
  SteamModSort,
  SteamModTrendDays,
  SteamModListQueryResult,
  SteamModDetailDto,
  ModContentLocale,
} from '../../../../shared/contracts/mod'
import {
  DEFAULT_MOD_CONTENT_LOCALE,
  modInstanceParamsSchema,
  modItemParamsSchema,
  modWorkshopParamsSchema,
  modListQuerySchema,
  steamModListQuerySchema,
  steamModDetailQuerySchema,
  modInstallPayloadSchema,
  modUpdatePayloadSchema,
  modReorderPayloadSchema,
  modInstallJobsQuerySchema,
} from '../../../../shared/contracts/mod'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { resolveInstanceInstallPath } from '../../infra/game-adapter/dst/cluster-service'
import {
  readModDependencyMap,
  writeModDependencyMap,
} from '../../infra/game-adapter/dst/mod-service'
import { LOCAL_NODE_ID, resolveLocalDstInstance } from '../../shared/dst/local-dst-instance'
import { syncInstanceModFilesFromDb } from './mod-file-sync-service'
import { fetchDstSteamWorkshopMods, fetchWorkshopFileDetail, fetchWorkshopPreviewImages, fetchWorkshopRatings, isSteamWorkshopFetchError, scheduleWarmSteamWorkshopModCache } from '../../infra/game-adapter/dst/steam-workshop'
import {
  deleteInstanceModByWorkshopId,
  getGameInstanceById,
  getInstanceModByWorkshopId,
  listGameInstances,
  listInstanceMods,
  updateInstanceModByWorkshopId,
} from '../../shared/db/index'
import { businessError, success } from '../../shared/http/response'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import { requirePermission } from '../system/auth'
import {
  enqueueModDownload,
  ensurePendingModDownloadsRecovered,
  listModInstallJobs,
  resolveModInstallJob,
} from './mod-download-service'

function normalizeWorkshopId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const unique = new Set<string>()
  for (const item of value) {
    const workshopId = normalizeWorkshopId(item)
    if (workshopId) {
      unique.add(workshopId)
    }
  }
  return [...unique]
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return fallback
}

function normalizeSteamSort(value: unknown): SteamModSort {
  if (value === 'mostrecent' || value === 'totaluniquesubscribers' || value === 'relevance') {
    return value
  }
  return 'trend'
}

function normalizeModContentLocale(value: unknown): ModContentLocale {
  if (value === 'en-US' || value === 'en') {
    return 'en-US'
  }
  return DEFAULT_MOD_CONTENT_LOCALE
}

function normalizeTrendDays(value: unknown): SteamModTrendDays {
  const accepted: SteamModTrendDays[] = [1, 7, 30, 90, 180, 365, -1]
  if (typeof value === 'number' && accepted.includes(value as SteamModTrendDays)) {
    return value as SteamModTrendDays
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (accepted.includes(parsed as SteamModTrendDays)) {
      return parsed as SteamModTrendDays
    }
  }
  return 7
}

function parseModListEnrich(value: unknown): { enrichRatings: boolean, enrichPreviews: boolean } {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return { enrichRatings: false, enrichPreviews: false }
  }
  const parts = raw.split(',').map(part => part.trim())
  return {
    enrichRatings: parts.includes('ratings'),
    enrichPreviews: parts.includes('previews'),
  }
}

function buildSubscribedModStatusMap(
  mods: Awaited<ReturnType<typeof listInstanceMods>>,
): Map<string, ModInstallStatus> {
  return new Map(mods.map(mod => [mod.workshopId, mod.installStatus]))
}

function normalizeSteamWorkshopError(error: unknown): {
  message: string
  data: Record<string, unknown>
} {
  if (isSteamWorkshopFetchError(error)) {
    if (error.code === 'STEAM_TIMEOUT') {
      return {
        message: '拉取 Steam 超时，请检查网络后重试',
        data: {
          steamErrorCode: error.code,
        },
      }
    }
    if (error.code === 'STEAM_RATE_LIMIT') {
      return {
        message: 'Steam 请求频率过高，请稍后重试',
        data: {
          steamErrorCode: error.code,
          retryAfterMs: error.retryAfterMs ?? undefined,
        },
      }
    }
    if (error.code === 'STEAM_PARSE_FAILED') {
      return {
        message: 'Steam 页面结构变化导致解析失败，请稍后重试',
        data: {
          steamErrorCode: error.code,
        },
      }
    }
    return {
      message: '无法连接 Steam 创意工坊，请检查服务器网络或代理设置后重试',
      data: {
        steamErrorCode: error.code,
        retryAfterMs: error.retryAfterMs ?? undefined,
      },
    }
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('fetch failed')) {
      return {
        message: '无法连接 Steam 创意工坊，请检查服务器网络或代理设置后重试',
        data: {},
      }
    }
    const technicalPatterns = [
      /^Command failed:/i,
      /powershell/i,
      /ParserError/i,
      /CategoryInfo/i,
      /FullyQualifiedErrorId/i,
      /At line:\d+/i,
    ]
    const message = error.message.trim()
    if (!message || technicalPatterns.some(pattern => pattern.test(message))) {
      return {
        message: '无法连接 Steam 创意工坊，请检查服务器网络或代理设置后重试',
        data: {},
      }
    }
    return {
      message,
      data: {},
    }
  }
  return {
    message: '拉取 Steam 创意工坊模组失败',
    data: {},
  }
}

function getRuntimeRiskTip(instanceStatus: ModListDto['instanceStatus']): string | null {
  if (instanceStatus !== 'running') {
    return null
  }
  return '实例运行中修改 Mod 可能导致玩家同步失败，建议在停服窗口执行并重启实例。'
}

function toDto(
  mod: Awaited<ReturnType<typeof listInstanceMods>>[number],
  dependencyMap: Record<string, string[]>,
  installedIds: Set<string>,
  ratingMap: Map<string, number | null>,
): ModItemDto {
  const dependencyIds = dependencyMap[mod.workshopId] ?? []
  const missingDependencyIds = dependencyIds.filter(id => !installedIds.has(id))
  const dependentModIds = Object.entries(dependencyMap)
    .filter(([workshopId, dependencies]) => workshopId !== mod.workshopId && dependencies.includes(mod.workshopId))
    .map(([workshopId]) => workshopId)
  return {
    id: mod.id,
    workshopId: mod.workshopId,
    name: mod.name,
    previewImage: mod.previewImage,
    rating: ratingMap.get(mod.workshopId) ?? null,
    enabled: mod.enabled,
    loadOrder: mod.loadOrder,
    version: mod.version,
    installStatus: mod.installStatus,
    installError: mod.installError,
    dependencyIds,
    missingDependencyIds,
    dependentModIds,
    createdAt: mod.createdAt,
    updatedAt: mod.updatedAt,
  }
}

function buildActiveInstallJobs(
  instanceId: string,
  mods: Awaited<ReturnType<typeof listInstanceMods>>,
): ModInstallJobDto[] {
  const memoryJobs = listModInstallJobs(instanceId)
  const trackedIds = new Set(memoryJobs.map(job => job.workshopId))
  const syntheticJobs: ModInstallJobDto[] = []
  for (const mod of mods) {
    if (mod.installStatus !== 'pending' || trackedIds.has(mod.workshopId)) {
      continue
    }
    syntheticJobs.push({
      instanceId,
      workshopId: mod.workshopId,
      status: 'downloading',
      phase: null,
      error: null,
      startedAt: mod.updatedAt,
      finishedAt: null,
    })
  }
  return [...memoryJobs, ...syntheticJobs]
}

function collectPendingWorkshopIds(
  instanceId: string,
  mods: Awaited<ReturnType<typeof listInstanceMods>>,
): Set<string> {
  const pending = new Set(
    mods.filter(mod => mod.installStatus === 'pending').map(mod => mod.workshopId),
  )
  for (const job of listModInstallJobs(instanceId)) {
    if (job.status === 'downloading') {
      pending.add(job.workshopId)
    }
  }
  return pending
}

async function enrichMissingModPreviewImages(instanceId: string, mods: Awaited<ReturnType<typeof listInstanceMods>>) {
  const missingIds = mods
    .filter(mod => !mod.previewImage?.trim())
    .map(mod => mod.workshopId)
  if (missingIds.length === 0) {
    return
  }
  const previewMap = await fetchWorkshopPreviewImages(missingIds)
  await Promise.all(missingIds.map(async (workshopId) => {
    const previewImage = previewMap.get(workshopId)
    if (!previewImage) {
      return
    }
    await updateInstanceModByWorkshopId(instanceId, workshopId, { previewImage })
  }))
}

async function buildModListPayload(
  instanceId: string,
  options?: { enrichRatings?: boolean, enrichPreviews?: boolean },
): Promise<ModListDto> {
  const instance = await getGameInstanceById(instanceId)
  if (!instance) {
    throw new Error('实例不存在')
  }
  const installPath = resolveInstanceInstallPath(instance)
  let mods = await listInstanceMods(instanceId)
  if (options?.enrichPreviews) {
    await enrichMissingModPreviewImages(instanceId, mods)
    mods = await listInstanceMods(instanceId)
  }
  const dependencyMap = readModDependencyMap(installPath)
  const installedIds = new Set(
    mods.filter(item => item.installStatus === 'ready').map(item => item.workshopId),
  )
  const ratingMap = options?.enrichRatings
    ? await fetchWorkshopRatings(mods.map(item => item.workshopId))
    : new Map<string, number | null>(mods.map(item => [item.workshopId, null]))
  return {
    instanceId,
    instanceName: instance.name,
    instanceStatus: instance.status,
    riskTip: getRuntimeRiskTip(instance.status),
    mods: mods.map(item => toDto(item, dependencyMap, installedIds, ratingMap)),
    activeInstallJobs: buildActiveInstallJobs(instanceId, mods),
  }
}

async function buildLightweightModDto(instanceId: string, workshopId: string): Promise<ModItemDto | null> {
  const mod = await getInstanceModByWorkshopId(instanceId, workshopId)
  if (!mod) {
    return null
  }
  const instance = await getGameInstanceById(instanceId)
  if (!instance) {
    return null
  }
  const installPath = resolveInstanceInstallPath(instance)
  const dependencyMap = readModDependencyMap(installPath)
  const readyMods = await listInstanceMods(instanceId)
  const installedIds = new Set(
    readyMods.filter(item => item.installStatus === 'ready').map(item => item.workshopId),
  )
  return toDto(mod, dependencyMap, installedIds, new Map([[mod.workshopId, null]]))
}

async function enrichInstallJobDto(instanceId: string, job: ModInstallJobDto): Promise<ModInstallJobDto> {
  if (job.status !== 'success') {
    return job
  }
  const mod = await buildLightweightModDto(instanceId, job.workshopId)
  return mod ? { ...job, mod } : job
}

function normalizeLoadOrder(mods: Awaited<ReturnType<typeof listInstanceMods>>) {
  return mods
    .sort((a, b) => a.loadOrder - b.loadOrder || a.createdAt.localeCompare(b.createdAt))
    .map((mod, index) => ({ ...mod, loadOrder: index }))
}

/**
 * mod 模块注册入口
 * 负责创意工坊安装、启停与排序，并维护 modoverrides.lua。
 */
export function registerModModule(app: FastifyInstance) {
  app.addHook('onReady', async () => {
    scheduleWarmSteamWorkshopModCache()
    const instances = await listGameInstances({ nodeId: LOCAL_NODE_ID })
    for (const instance of instances) {
      if (instance.gameCode !== DST_APP_ID) {
        continue
      }
      const installPath = resolveInstanceInstallPath(instance)
      if (!fs.existsSync(installPath)) {
        continue
      }
      await ensurePendingModDownloadsRecovered({
        instanceId: instance.id,
        installPath,
      })
    }
  })

  app.get('/app/instances/:instanceId/mods', async (request): Promise<ApiSuccessResponse<ModListDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modInstanceParamsSchema.safeParse(request.params)
    const parsedQuery = modListQuerySchema.safeParse(request.query)
    if (!parsedParams.success || !parsedQuery.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      await ensurePendingModDownloadsRecovered({
        instanceId,
        installPath: resolved.instance.installPath,
      })
      const enrich = parseModListEnrich(parsedQuery.data.enrich)
      const payload = await buildModListPayload(instanceId, enrich)
      return success(payload, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '读取 Mod 列表失败'
      return businessError(message, request)
    }
  })

  app.get('/app/instances/:instanceId/mods/steam', async (request): Promise<ApiSuccessResponse<SteamModListQueryResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modInstanceParamsSchema.safeParse(request.params)
    const parsedQuery = steamModListQuerySchema.safeParse(request.query)
    if (!parsedParams.success || !parsedQuery.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const installedMods = await listInstanceMods(instanceId)
      const subscribedModStatusByWorkshopId = buildSubscribedModStatusMap(installedMods)
      const pendingWorkshopIds = collectPendingWorkshopIds(instanceId, installedMods)
      const payload = await fetchDstSteamWorkshopMods({
        keyword: parsedQuery.data.keyword ?? '',
        page: normalizePositiveNumber(parsedQuery.data.page, 1),
        pageSize: normalizePositiveNumber(parsedQuery.data.pageSize, 20),
        sort: normalizeSteamSort(parsedQuery.data.sort),
        trendDays: normalizeTrendDays(parsedQuery.data.trendDays),
        subscribedModStatusByWorkshopId,
        pendingWorkshopIds,
      })
      return success(payload, request)
    }
    catch (error) {
      const normalized = normalizeSteamWorkshopError(error)
      return businessError(normalized.message, request, undefined, normalized.data)
    }
  })

  app.get('/app/instances/:instanceId/mods/steam/:workshopId', async (request): Promise<ApiSuccessResponse<SteamModDetailDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modWorkshopParamsSchema.safeParse(request.params)
    const parsedQuery = steamModDetailQuerySchema.safeParse(request.query)
    if (!parsedParams.success || !parsedQuery.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const workshopId = parsedParams.data.workshopId
    const locale = normalizeModContentLocale(parsedQuery.data.locale)
    if (!workshopId) {
      return businessError('创意工坊 ID 不能为空', request)
    }
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const installedMods = await listInstanceMods(instanceId)
      const detail = await fetchWorkshopFileDetail(workshopId, locale)
      const modRecord = installedMods.find(mod => mod.workshopId === workshopId)
      const subscribeStatus = modRecord?.installStatus ?? null
      const payload: SteamModDetailDto = {
        ...detail,
        subscribed: subscribeStatus !== null,
        subscribeStatus,
        installed: subscribeStatus === 'ready',
      }
      return success(payload, request)
    }
    catch (error) {
      const normalized = normalizeSteamWorkshopError(error)
      return businessError(normalized.message, request, undefined, normalized.data)
    }
  })

  app.post('/app/instances/:instanceId/mods/install', async (request): Promise<ApiSuccessResponse<ModInstallJobDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modInstanceParamsSchema.safeParse(request.params)
    const parsedBody = modInstallPayloadSchema.safeParse(request.body ?? {})
    if (!parsedParams.success || !parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    const body = parsedBody.data
    const workshopId = normalizeWorkshopId(body.workshopId)
    if (!workshopId) {
      return businessError('创意工坊 ID 不能为空', request)
    }
    const job = await enqueueModDownload({
      instanceId,
      installPath: resolved.instance.installPath,
      payload: body,
    })
    return success(await enrichInstallJobDto(instanceId, job), request)
  })

  app.get('/app/instances/:instanceId/mods/install-jobs/:workshopId', async (request): Promise<ApiSuccessResponse<ModInstallJobDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modWorkshopParamsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const workshopId = parsedParams.data.workshopId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    if (!workshopId) {
      return businessError('创意工坊 ID 不能为空', request)
    }
    const job = await resolveModInstallJob(instanceId, workshopId)
    return success(await enrichInstallJobDto(instanceId, job), request)
  })

  app.get('/app/instances/:instanceId/mods/install-jobs', async (request): Promise<ApiSuccessResponse<ModInstallJobDto[]> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modInstanceParamsSchema.safeParse(request.params)
    const parsedQuery = modInstallJobsQuerySchema.safeParse(request.query)
    if (!parsedParams.success || !parsedQuery.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    const rawIds = parsedQuery.data.workshopIds
    const workshopIds = Array.isArray(rawIds)
      ? rawIds.flatMap(id => normalizeDependencyIds([id]))
      : (typeof rawIds === 'string' && rawIds.trim()
          ? normalizeDependencyIds(rawIds.split(','))
          : undefined)
    const jobs = listModInstallJobs(instanceId, workshopIds)
    const enriched = await Promise.all(jobs.map(job => enrichInstallJobDto(instanceId, job)))
    return success(enriched, request)
  })

  app.put('/app/instances/:instanceId/mods/:modId', async (request): Promise<ApiSuccessResponse<ModMutationResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modItemParamsSchema.safeParse(request.params)
    const parsedBody = modUpdatePayloadSchema.safeParse(request.body ?? {})
    if (!parsedParams.success || !parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const modId = parsedParams.data.modId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    if (!modId) {
      return businessError('Mod ID 不能为空', request)
    }
    const body = parsedBody.data
    const mod = await getInstanceModByWorkshopId(instanceId, modId)
    if (!mod) {
      return businessError('Mod 不存在', request)
    }
    if (mod.installStatus !== 'ready') {
      return businessError('Mod 尚未下载完成，请等待订阅完成后再操作', request)
    }
    const updated = await updateInstanceModByWorkshopId(instanceId, modId, {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      name: typeof body.name === 'string' ? body.name.trim() || mod.name : undefined,
      version: typeof body.version === 'string' ? body.version.trim() || null : undefined,
    })
    const dependencyMap = readModDependencyMap(resolved.instance.installPath)
    if (Array.isArray(body.dependencyIds)) {
      dependencyMap[modId] = normalizeDependencyIds(body.dependencyIds)
      writeModDependencyMap(resolved.instance.installPath, dependencyMap)
    }
    await syncInstanceModFilesFromDb(instanceId, resolved.instance.installPath)
    const payload = await buildModListPayload(instanceId)
    const dto = payload.mods.find(item => item.workshopId === modId)
    if (!updated || !dto) {
      return businessError('Mod 更新失败', request)
    }
    return success({
      saved: true,
      riskTip: payload.riskTip,
      mod: dto,
    }, request)
  })

  app.put('/app/instances/:instanceId/mods/reorder', async (request): Promise<ApiSuccessResponse<ModReorderResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modInstanceParamsSchema.safeParse(request.params)
    const parsedBody = modReorderPayloadSchema.safeParse(request.body ?? {})
    if (!parsedParams.success || !parsedBody.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    const body = parsedBody.data
    const workshopIds = normalizeDependencyIds(body.workshopIds)
    const currentMods = normalizeLoadOrder(
      (await listInstanceMods(instanceId)).filter(mod => mod.installStatus === 'ready'),
    )
    if (currentMods.length !== workshopIds.length) {
      return businessError('排序参数与当前 Mod 数量不一致', request)
    }
    const currentIdSet = new Set(currentMods.map(mod => mod.workshopId))
    if (workshopIds.some(workshopId => !currentIdSet.has(workshopId))) {
      return businessError('排序参数包含未知 Mod ID', request)
    }
    for (let index = 0; index < workshopIds.length; index++) {
      const workshopId = workshopIds[index]
      await updateInstanceModByWorkshopId(instanceId, workshopId, { loadOrder: index })
    }
    await syncInstanceModFilesFromDb(instanceId, resolved.instance.installPath)
    const payload = await buildModListPayload(instanceId)
    return success({
      saved: true,
      riskTip: payload.riskTip,
      mods: payload.mods,
    }, request)
  })

  app.delete('/app/instances/:instanceId/mods/:modId', async (request): Promise<ApiSuccessResponse<ModDeleteResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const parsedParams = modItemParamsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = parsedParams.data.instanceId
    const modId = parsedParams.data.modId
    const resolved = await resolveLocalDstInstance(instanceId, request, {
      messages: {
        wrongNode: '当前仅支持本地节点实例 Mod 管理',
        wrongGame: '当前仅支持 DST 实例 Mod 管理',
        missingInstallPath: '实例安装目录不存在，请先完成安装',
      },
    })
    if (!resolved.ok) {
      return resolved.error
    }
    if (!modId) {
      return businessError('Mod ID 不能为空', request)
    }
    const deleted = await deleteInstanceModByWorkshopId(instanceId, modId)
    if (!deleted) {
      return businessError('Mod 不存在', request)
    }
    const dependencyMap = readModDependencyMap(resolved.instance.installPath)
    delete dependencyMap[modId]
    for (const workshopId of Object.keys(dependencyMap)) {
      dependencyMap[workshopId] = dependencyMap[workshopId].filter(dep => dep !== modId)
    }
    writeModDependencyMap(resolved.instance.installPath, dependencyMap)
    const normalized = normalizeLoadOrder(await listInstanceMods(instanceId))
    for (const mod of normalized) {
      await updateInstanceModByWorkshopId(instanceId, mod.workshopId, { loadOrder: mod.loadOrder })
    }
    await syncInstanceModFilesFromDb(instanceId, resolved.instance.installPath)
    return success({
      deleted: true,
      riskTip: getRuntimeRiskTip(resolved.instance.status),
    }, request)
  })
}
