import type { ModInstallJobDto, ModInstallJobPhase, ModInstallJobStatus, ModInstallPayload } from '../../../../shared/contracts/mod'
import {
  downloadDstWorkshopMods,
  formatMissingWorkshopModError,
  isDstWorkshopModPresent,
} from '../../infra/game-adapter/dst/mod-download'
import {
  readModDependencyMap,
  writeModDependencyMap,
} from '../../infra/game-adapter/dst/mod-service'
import { resolveModDisplayName } from '../../infra/game-adapter/dst/mod-config'
import { ensureDstUgcModLayout } from '../../infra/game-adapter/dst/ugc-mod-install'
import { readWorkshopInstalledItem, unixSecondsToIsoOrNull } from '../../infra/game-adapter/dst/workshop-manifest'
import { syncInstanceModFilesFromDb } from './mod-file-sync-service'
import { isPlaceholderModName, MISSING_MOD_CONTENT_ERROR } from './mod-readiness-service'
import {
  getInstanceModByWorkshopId,
  listInstanceMods,
  updateInstanceModByWorkshopId,
  upsertInstanceMod,
} from '../../shared/db/index'

export interface ModDownloadJobInput {
  instanceId: string
  installPath: string
  payload: ModInstallPayload
  /** 为 true 时跳过「已就绪且文件存在」短路，强制重新下载 */
  force?: boolean
}

interface ModInstallJobRecord {
  instanceId: string
  workshopId: string
  status: Exclude<ModInstallJobStatus, 'not_found'>
  phase: ModInstallJobPhase | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

const modInstallJobs = new Map<string, ModInstallJobRecord>()
const modInstallJobsInFlight = new Map<string, Promise<void>>()
const modEnqueueLocks = new Set<string>()

const DEFAULT_WORKSHOP_DOWNLOAD_TIMEOUT_MS = readPositiveIntEnv('GSH_STEAMCMD_WORKSHOP_DOWNLOAD_TIMEOUT_MS', 10 * 60 * 1000)
/** 单次 SteamCMD 调用最多顺带补齐多少个缺失 Mod（非法值回落到默认值） */
const MOD_DOWNLOAD_COALESCE_LIMIT = readPositiveIntEnv('GSH_MOD_DOWNLOAD_COALESCE_LIMIT', 50)

type ModDownloadExecutor = typeof downloadDstWorkshopMods
let modDownloadExecutor: ModDownloadExecutor = downloadDstWorkshopMods

type ListInstanceModsFn = typeof listInstanceMods
type GetInstanceModByWorkshopIdFn = typeof getInstanceModByWorkshopId
type UpsertInstanceModFn = typeof upsertInstanceMod
type UpdateInstanceModByWorkshopIdFn = typeof updateInstanceModByWorkshopId

let listInstanceModsFn: ListInstanceModsFn = listInstanceMods
let getInstanceModByWorkshopIdFn: GetInstanceModByWorkshopIdFn = getInstanceModByWorkshopId
let upsertInstanceModFn: UpsertInstanceModFn = upsertInstanceMod
let updateInstanceModByWorkshopIdFn: UpdateInstanceModByWorkshopIdFn = updateInstanceModByWorkshopId

function readPositiveIntEnv(key: string, fallback: number): number {
  const rawValue = process.env[key]
  if (!rawValue) {
    return fallback
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildJobKey(instanceId: string, workshopId: string) {
  return `${instanceId}:${workshopId}`
}

function normalizeDependencyIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const unique = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      unique.add(item.trim())
    }
  }
  return [...unique]
}

function toJobDto(record: ModInstallJobRecord): ModInstallJobDto {
  return {
    instanceId: record.instanceId,
    workshopId: record.workshopId,
    status: record.status,
    phase: record.phase,
    error: record.error,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  }
}

function collectDownloadWorkshopIds(payload: ModInstallPayload): string[] {
  const dependencyIds = normalizeDependencyIds(payload.dependencyIds)
  const workshopId = payload.workshopId.trim()
  const ordered = dependencyIds.filter(id => id !== workshopId)
  if (workshopId) {
    ordered.push(workshopId)
  }
  return [...uniqueOrderedIds(ordered)]
}

function uniqueOrderedIds(ids: string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))]
}

function isRecentDownloadingRecord(record: ModInstallJobRecord | undefined): boolean {
  if (!record || record.status !== 'downloading') {
    return false
  }
  if (modInstallJobsInFlight.has(buildJobKey(record.instanceId, record.workshopId))) {
    return true
  }
  if (!record.startedAt) {
    return false
  }
  const elapsed = Date.now() - Date.parse(record.startedAt)
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < DEFAULT_WORKSHOP_DOWNLOAD_TIMEOUT_MS
}

async function upsertPendingModRecord(input: ModDownloadJobInput) {
  const { instanceId, payload } = input
  const workshopId = payload.workshopId.trim()
  const mods = await listInstanceModsFn(instanceId)
  const existing = mods.find(mod => mod.workshopId === workshopId)
  const nextLoadOrder = existing ? existing.loadOrder : mods.length
  await upsertInstanceModFn({
    instanceId,
    workshopId,
    name: payload.name?.trim() || `Workshop Mod ${workshopId}`,
    previewImage: payload.previewImage?.trim() || null,
    enabled: typeof payload.enabled === 'boolean'
      ? payload.enabled
      : (existing?.enabled ?? false),
    loadOrder: nextLoadOrder,
    version: payload.version?.trim() || null,
    installStatus: 'pending',
    installError: null,
  })
}

/**
 * 下载完成后登记的 Mod 名：订阅走 UI 时带的是 Steam 上的真实名称，
 * 而导入存档触发的补下载只带着 `workshop-<id>` 占位名，此时从已落地的 modinfo.lua 补齐。
 */
function resolvePersistedModName(installPath: string, workshopId: string, requestedName?: string): string {
  const trimmed = requestedName?.trim() ?? ''
  if (trimmed && !isPlaceholderModName(trimmed)) {
    return trimmed
  }
  return resolveModDisplayName(installPath, workshopId) || trimmed || `Workshop Mod ${workshopId}`
}

/**
 * 本机已下载内容对应的工坊版本时间：优先读 SteamCMD 清单里的 timeupdated。
 * 强制更新后清单里未必立刻有条目（例如历史实例没有清单），此时按「刚下过最新版本」记当前时间，
 * 使状态不会卡在「无法判定」；下一次版本检查会以清单/工坊为准自动纠正。
 */
function resolveInstalledUpdatedAtIso(
  installPath: string,
  workshopId: string,
  fallbackToNow: boolean,
): string | null {
  const item = readWorkshopInstalledItem(installPath, workshopId)
  const fromManifest = unixSecondsToIsoOrNull(item?.timeupdated)
  if (fromManifest) {
    return fromManifest
  }
  return fallbackToNow ? new Date().toISOString() : null
}

async function persistSubscribedMod(input: ModDownloadJobInput) {
  const { instanceId, installPath, payload } = input
  const workshopId = payload.workshopId.trim()
  const mods = await listInstanceModsFn(instanceId)
  const existing = mods.find(mod => mod.workshopId === workshopId)
  const nextLoadOrder = existing ? existing.loadOrder : mods.length
  const localUpdatedAt = resolveInstalledUpdatedAtIso(installPath, workshopId, input.force === true)
  await upsertInstanceModFn({
    instanceId,
    workshopId,
    name: resolvePersistedModName(installPath, workshopId, payload.name),
    previewImage: payload.previewImage?.trim() || null,
    enabled: typeof payload.enabled === 'boolean'
      ? payload.enabled
      : (existing?.enabled ?? false),
    loadOrder: nextLoadOrder,
    version: payload.version?.trim() || null,
    installStatus: 'ready',
    installError: null,
    ...(localUpdatedAt ? { localUpdatedAt } : {}),
    // 强制更新成功即代表本机已是工坊上的最新版本，直接给出一致结论，免得紧接着再判成「未知」
    ...(input.force === true && localUpdatedAt
      ? { remoteUpdatedAt: localUpdatedAt, updateCheckedAt: new Date().toISOString() }
      : {}),
  })
  const dependencyMap = readModDependencyMap(installPath)
  const dependencyIds = normalizeDependencyIds(payload.dependencyIds)
  if (dependencyIds.length > 0) {
    dependencyMap[workshopId] = dependencyIds
  }
  else if (!existing) {
    dependencyMap[workshopId] = []
  }
  writeModDependencyMap(installPath, dependencyMap)
  await syncInstanceModFilesFromDb(instanceId, installPath)
}

async function markModInstallFailed(instanceId: string, workshopId: string, error: string) {
  await updateInstanceModByWorkshopIdFn(instanceId, workshopId, {
    installStatus: 'failed',
    installError: error,
  })
}

/**
 * 顺带补齐的 Mod 名单：同一个实例里还没就绪、且确定缺文件的 Mod。
 *
 * 每个 Mod 起一次 SteamCMD 意味着重新登录一次 Steam，导入存档后几十个 Mod 就是几十次，
 * 慢且失败面成倍放大。把当前确定缺的都塞进同一次调用，其余任务随后会因内容已就位而
 * 短路成成功（见 enqueueModDownload 的就绪短路）。
 */
async function collectCoalescedWorkshopIds(input: ModDownloadJobInput, primaryIds: string[]): Promise<string[]> {
  const extraSlots = MOD_DOWNLOAD_COALESCE_LIMIT - primaryIds.length
  if (extraSlots <= 0) {
    return primaryIds
  }
  try {
    const mods = await listInstanceModsFn(input.instanceId)
    const present = new Set(primaryIds)
    const extra: string[] = []
    for (const mod of mods) {
      if (extra.length >= extraSlots) {
        break
      }
      if (mod.installStatus === 'ready' || present.has(mod.workshopId)) {
        continue
      }
      if (isDstWorkshopModPresent(input.installPath, mod.workshopId)) {
        continue
      }
      extra.push(mod.workshopId)
    }
    return [...primaryIds, ...extra]
  }
  catch {
    return primaryIds
  }
}

/** 同一次 SteamCMD 顺带下好的其它 Mod：内容已就位，直接把记录改成已就绪 */
async function persistCoalescedReadyMods(input: ModDownloadJobInput, workshopIds: string[]) {
  if (workshopIds.length === 0) {
    return
  }
  const mods = await listInstanceModsFn(input.instanceId)
  for (const workshopId of workshopIds) {
    const mod = mods.find(item => item.workshopId === workshopId)
    if (!mod || mod.installStatus === 'ready') {
      continue
    }
    const localUpdatedAt = resolveInstalledUpdatedAtIso(input.installPath, workshopId, true)
    await upsertInstanceModFn({
      instanceId: input.instanceId,
      workshopId,
      name: resolvePersistedModName(input.installPath, workshopId, mod.name),
      previewImage: mod.previewImage,
      enabled: mod.enabled,
      loadOrder: mod.loadOrder,
      version: mod.version,
      installStatus: 'ready',
      installError: null,
      ...(localUpdatedAt ? { localUpdatedAt } : {}),
    })
  }
}

/** 顺带下载失败的 Mod：只把它们自己标失败，不牵连同批次的其它 Mod */
async function markCoalescedMissingMods(input: ModDownloadJobInput, missingIds: string[]) {
  if (missingIds.length === 0) {
    return
  }
  const mods = await listInstanceModsFn(input.instanceId)
  for (const workshopId of missingIds) {
    const mod = mods.find(item => item.workshopId === workshopId)
    if (!mod || mod.installStatus === 'ready') {
      continue
    }
    await markModInstallFailed(input.instanceId, workshopId, MISSING_MOD_CONTENT_ERROR)
  }
}

async function runModDownloadJob(input: ModDownloadJobInput, record: ModInstallJobRecord) {
  const workshopId = input.payload.workshopId.trim()
  const downloadIds = collectDownloadWorkshopIds(input.payload)
  const batchIds = await collectCoalescedWorkshopIds(input, downloadIds)
  const downloadResult = await modDownloadExecutor({
    hostInstallPath: input.installPath,
    workshopIds: batchIds,
    instanceId: input.instanceId,
    force: input.force === true,
    onAwaitingSteamcmdLock: () => {
      record.phase = 'waiting_steamcmd'
    },
    onDownloadStart: () => {
      record.phase = 'downloading'
    },
  })
  if (!downloadResult.ok) {
    record.status = 'failed'
    record.phase = null
    record.error = downloadResult.error ?? 'Mod 下载失败，请稍后重试'
    record.finishedAt = new Date().toISOString()
    await markModInstallFailed(input.instanceId, workshopId, record.error)
    return
  }
  const allPresent = downloadIds.every(id => isDstWorkshopModPresent(input.installPath, id))
  if (!allPresent) {
    const missingIds = downloadIds.filter(id => !isDstWorkshopModPresent(input.installPath, id))
    record.status = 'failed'
    record.phase = null
    record.error = formatMissingWorkshopModError(input.installPath, missingIds)
    record.finishedAt = new Date().toISOString()
    await markModInstallFailed(input.instanceId, workshopId, record.error)
    return
  }
  // 顺带进来的 Mod 没下到不影响本次任务；只把它们自己标失败，等下一次重试
  const coalescedIds = batchIds.filter(id => !downloadIds.includes(id))
  await markCoalescedMissingMods(
    input,
    coalescedIds.filter(id => !isDstWorkshopModPresent(input.installPath, id)),
  )
  // DST 专用服只从 ugc_mods 读取创意工坊 Mod；只下载到 steamapps 时服务器会自行联网重下，
  // legacy 包（ugchandle）在容器网络下常因超时失败，表现为「已启用但游戏里没有」。
  // 强制更新时必须 refresh：目标目录里还是旧版本，跳过落位等于没更新。
  const layoutOutcomes = await ensureDstUgcModLayout(input.installPath, batchIds, {
    refresh: input.force === true,
  })
  const layoutFailure = layoutOutcomes.find(
    outcome => outcome.status === 'failed' && downloadIds.includes(outcome.workshopId),
  )
  if (layoutFailure) {
    record.status = 'failed'
    record.phase = null
    record.error = `Mod 文件未能安装到服务器目录：${layoutFailure.error ?? layoutFailure.workshopId}`
    record.finishedAt = new Date().toISOString()
    await markModInstallFailed(input.instanceId, workshopId, record.error)
    return
  }
  await markCoalescedMissingMods(
    input,
    layoutOutcomes
      .filter(outcome => outcome.status === 'failed' && !downloadIds.includes(outcome.workshopId))
      .map(outcome => outcome.workshopId),
  )
  await persistSubscribedMod(input)
  await persistCoalescedReadyMods(
    input,
    coalescedIds.filter(id => isDstWorkshopModPresent(input.installPath, id)),
  )
  record.status = 'success'
  record.phase = null
  record.error = null
  record.finishedAt = new Date().toISOString()
}

function startModDownloadJob(input: ModDownloadJobInput): ModInstallJobRecord {
  const workshopId = input.payload.workshopId.trim()
  const key = buildJobKey(input.instanceId, workshopId)
  const startedAt = new Date().toISOString()
  const record: ModInstallJobRecord = {
    instanceId: input.instanceId,
    workshopId,
    status: 'downloading',
    phase: 'downloading',
    error: null,
    startedAt,
    finishedAt: null,
  }
  modInstallJobs.set(key, record)

  const task = (async () => {
    try {
      await runModDownloadJob(input, record)
    }
    catch (error) {
      record.status = 'failed'
      record.phase = null
      record.error = error instanceof Error ? error.message : 'Mod 下载失败，请稍后重试'
      record.finishedAt = new Date().toISOString()
      await markModInstallFailed(input.instanceId, workshopId, record.error)
    }
    finally {
      modInstallJobsInFlight.delete(key)
    }
  })()
  modInstallJobsInFlight.set(key, task)
  void task
  return record
}

export function getModInstallJob(instanceId: string, workshopId: string): ModInstallJobDto {
  const key = buildJobKey(instanceId, workshopId.trim())
  const record = modInstallJobs.get(key)
  if (!record) {
    return {
      instanceId,
      workshopId: workshopId.trim(),
      status: 'not_found',
      phase: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    }
  }
  return toJobDto(record)
}

export async function resolveModInstallJob(instanceId: string, workshopId: string): Promise<ModInstallJobDto> {
  const normalizedId = workshopId.trim()
  const key = buildJobKey(instanceId, normalizedId)
  const memoryJob = getModInstallJob(instanceId, normalizedId)
  if (memoryJob.status !== 'not_found') {
    return memoryJob
  }
  if (modInstallJobsInFlight.has(key)) {
    const inFlightRecord = modInstallJobs.get(key)
    if (inFlightRecord) {
      return toJobDto(inFlightRecord)
    }
    return {
      instanceId,
      workshopId: normalizedId,
      status: 'downloading',
      phase: 'downloading',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
  }
  const mod = await getInstanceModByWorkshopIdFn(instanceId, normalizedId)
  if (!mod) {
    return memoryJob
  }
  if (mod.installStatus === 'ready') {
    return {
      instanceId,
      workshopId: normalizedId,
      status: 'success',
      phase: null,
      error: null,
      startedAt: mod.updatedAt,
      finishedAt: mod.updatedAt,
    }
  }
  if (mod.installStatus === 'failed') {
    return {
      instanceId,
      workshopId: normalizedId,
      status: 'failed',
      phase: null,
      error: mod.installError,
      startedAt: mod.updatedAt,
      finishedAt: mod.updatedAt,
    }
  }
  const record = modInstallJobs.get(key)
  if (record && (record.status === 'downloading' || modInstallJobsInFlight.has(key))) {
    return toJobDto(record)
  }
  if (modInstallJobsInFlight.has(key)) {
    return {
      instanceId,
      workshopId: normalizedId,
      status: 'downloading',
      phase: 'downloading',
      error: null,
      startedAt: mod.updatedAt,
      finishedAt: null,
    }
  }
  const interruptedError = mod.installError || '下载任务已中断，请点击重试'
  await updateInstanceModByWorkshopIdFn(instanceId, normalizedId, {
    installStatus: 'failed',
    installError: interruptedError,
  })
  return {
    instanceId,
    workshopId: normalizedId,
    status: 'failed',
    phase: null,
    error: interruptedError,
    startedAt: mod.updatedAt,
    finishedAt: new Date().toISOString(),
  }
}

export function listModInstallJobs(instanceId: string, workshopIds?: string[]): ModInstallJobDto[] {
  const normalizedIds = workshopIds?.map(id => id.trim()).filter(Boolean)
  const jobs: ModInstallJobDto[] = []
  for (const record of modInstallJobs.values()) {
    if (record.instanceId !== instanceId) {
      continue
    }
    if (normalizedIds && normalizedIds.length > 0 && !normalizedIds.includes(record.workshopId)) {
      continue
    }
    jobs.push(toJobDto(record))
  }
  return jobs
}

export async function ensurePendingModDownloadsRecovered(input: {
  instanceId: string
  installPath: string
}) {
  const mods = await listInstanceModsFn(input.instanceId)
  for (const mod of mods) {
    if (mod.installStatus !== 'pending') {
      continue
    }
    const key = buildJobKey(input.instanceId, mod.workshopId)
    if (modInstallJobsInFlight.has(key) || isRecentDownloadingRecord(modInstallJobs.get(key))) {
      continue
    }
    startModDownloadJob({
      instanceId: input.instanceId,
      installPath: input.installPath,
      payload: {
        workshopId: mod.workshopId,
        name: mod.name,
        previewImage: mod.previewImage ?? undefined,
      },
    })
  }
}

export async function enqueueModDownload(input: ModDownloadJobInput): Promise<ModInstallJobDto> {
  const workshopId = input.payload.workshopId.trim()
  const key = buildJobKey(input.instanceId, workshopId)

  while (modEnqueueLocks.has(key)) {
    await sleep(10)
    const lockedRecord = modInstallJobs.get(key)
    if (lockedRecord?.status === 'downloading') {
      return toJobDto(lockedRecord)
    }
  }
  modEnqueueLocks.add(key)
  try {
    const downloadIds = collectDownloadWorkshopIds(input.payload)
    const existingMod = await getInstanceModByWorkshopIdFn(input.instanceId, workshopId)
    const filesReady = downloadIds.every(id => isDstWorkshopModPresent(input.installPath, id))

    if (!input.force && existingMod?.installStatus === 'ready' && filesReady) {
      const now = new Date().toISOString()
      const record: ModInstallJobRecord = {
        instanceId: input.instanceId,
        workshopId,
        status: 'success',
        phase: null,
        error: null,
        startedAt: now,
        finishedAt: now,
      }
      modInstallJobs.set(key, record)
      return toJobDto(record)
    }

    const current = modInstallJobs.get(key)
    if (current?.status === 'downloading' && (modInstallJobsInFlight.has(key) || isRecentDownloadingRecord(current))) {
      return toJobDto(current)
    }

    if (existingMod?.installStatus === 'failed') {
      await updateInstanceModByWorkshopIdFn(input.instanceId, workshopId, {
        installStatus: 'pending',
        installError: null,
      })
    }

    await upsertPendingModRecord(input)
    const record = startModDownloadJob(input)
    return toJobDto(record)
  }
  finally {
    modEnqueueLocks.delete(key)
  }
}

export async function waitForModInstallJob(instanceId: string, workshopId: string): Promise<void> {
  const key = buildJobKey(instanceId, workshopId.trim())
  const task = modInstallJobsInFlight.get(key)
  if (task) {
    await task
  }
}

/** 测试专用：清空内存 job 状态 */
export function resetModInstallJobsForTest() {
  modInstallJobs.clear()
  modInstallJobsInFlight.clear()
  modEnqueueLocks.clear()
}

/** 测试专用：替换 Mod 下载执行器 */
export function setModDownloadExecutorForTest(executor: ModDownloadExecutor) {
  modDownloadExecutor = executor
}

/** 测试专用：恢复默认 Mod 下载执行器 */
export function resetModDownloadExecutorForTest() {
  modDownloadExecutor = downloadDstWorkshopMods
}

export function setModDownloadDbHooksForTest(hooks: {
  listInstanceMods?: ListInstanceModsFn
  getInstanceModByWorkshopId?: GetInstanceModByWorkshopIdFn
  upsertInstanceMod?: UpsertInstanceModFn
  updateInstanceModByWorkshopId?: UpdateInstanceModByWorkshopIdFn
}) {
  if (hooks.listInstanceMods) {
    listInstanceModsFn = hooks.listInstanceMods
  }
  if (hooks.getInstanceModByWorkshopId) {
    getInstanceModByWorkshopIdFn = hooks.getInstanceModByWorkshopId
  }
  if (hooks.upsertInstanceMod) {
    upsertInstanceModFn = hooks.upsertInstanceMod
  }
  if (hooks.updateInstanceModByWorkshopId) {
    updateInstanceModByWorkshopIdFn = hooks.updateInstanceModByWorkshopId
  }
}

export function resetModDownloadDbHooksForTest() {
  listInstanceModsFn = listInstanceMods
  getInstanceModByWorkshopIdFn = getInstanceModByWorkshopId
  upsertInstanceModFn = upsertInstanceMod
  updateInstanceModByWorkshopIdFn = updateInstanceModByWorkshopId
}
