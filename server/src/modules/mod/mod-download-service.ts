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
import { resolveLocalModContentVersion } from '../../infra/game-adapter/dst/mod-content-version'
import type { LocalModContentVersion } from '../../infra/game-adapter/dst/mod-content-version'
import { readWorkshopInstalledItems } from '../../infra/game-adapter/dst/workshop-manifest'
import type { WorkshopInstalledItem } from '../../infra/game-adapter/dst/workshop-manifest'
import { fetchWorkshopModMetadata } from '../../infra/game-adapter/dst/steam-workshop'
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
type FetchWorkshopModMetadataFn = typeof fetchWorkshopModMetadata

let listInstanceModsFn: ListInstanceModsFn = listInstanceMods
let getInstanceModByWorkshopIdFn: GetInstanceModByWorkshopIdFn = getInstanceModByWorkshopId
let upsertInstanceModFn: UpsertInstanceModFn = upsertInstanceMod
let updateInstanceModByWorkshopIdFn: UpdateInstanceModByWorkshopIdFn = updateInstanceModByWorkshopId
let fetchWorkshopModMetadataFn: FetchWorkshopModMetadataFn = fetchWorkshopModMetadata

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
 * 本机已下载内容对应的版本：SteamCMD 清单优先，其次内容文件的落地时间。
 *
 * 两者都取不到就是「不知道」，**不**回落到当前时刻：记录时刻必然晚于当时的工坊版本，
 * 拿它去比等于恒定得出「已是最新」，真正存在的旧版本会被漏报。
 */
function resolveInstalledContentVersion(
  installPath: string,
  workshopId: string,
  installedItems?: Map<string, WorkshopInstalledItem>,
): LocalModContentVersion {
  return resolveLocalModContentVersion(
    installPath,
    workshopId,
    installedItems ? { installedItems } : undefined,
  )
}

/**
 * 下载/校验完成后核对一次工坊当前版本时间，供写库时当「远端版本」。
 *
 * 这一步让状态立刻有据可依：刚经 SteamCMD 处理过的内容若仍早于工坊时间，说明这次
 * 更新没有真正生效（SteamCMD 空跑、内容没换），状态会停在「有新版本」而不会被写成
 * 「已是最新」。工坊取不到就什么都不写，留给下一次检查判定。
 *
 * 这里刻意**不**强制刷新：用户通常是先点「检查更新」再点「更新」，那份十分钟内的
 * 结果正好可以复用，批量更新几十个 Mod 时不会变成几十次接口调用。
 */
async function fetchWorkshopUpdatedAtMap(workshopIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(workshopIds.map(id => id.trim()).filter(Boolean))]
  const result = new Map<string, string>()
  if (ids.length === 0) {
    return result
  }
  try {
    const metadata = await fetchWorkshopModMetadataFn(ids)
    for (const [workshopId, item] of metadata.items) {
      const updatedAt = item.updatedAt?.trim()
      if (updatedAt) {
        result.set(workshopId, updatedAt)
      }
    }
  }
  catch {
    // 工坊不可达不影响下载结果：状态留在「未检查」，等下一次检查
  }
  return result
}

async function persistSubscribedMod(input: ModDownloadJobInput) {
  const { instanceId, installPath, payload } = input
  const workshopId = payload.workshopId.trim()
  const mods = await listInstanceModsFn(instanceId)
  const existing = mods.find(mod => mod.workshopId === workshopId)
  const nextLoadOrder = existing ? existing.loadOrder : mods.length
  const localVersion = resolveInstalledContentVersion(installPath, workshopId)
  const workshopUpdatedAt = (await fetchWorkshopUpdatedAtMap([workshopId])).get(workshopId) ?? null
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
    // 无凭据时显式写 null：宁可回答「不知道」，也不留下会被误当成「已是最新」的时刻
    localUpdatedAt: localVersion.updatedAt,
    // 刚下载并落位过，游戏加载的那份就是本次内容；依旧按磁盘实际比对，不假设成功
    loadedCopyStale: localVersion.loadedCopyStale,
    // 远端只写工坊给出的时间。本机内容是否已经追平它，由两侧时间比较得出，
    // 不在这里复制本机时间自证「已是最新」。
    ...(workshopUpdatedAt
      ? { remoteUpdatedAt: workshopUpdatedAt, updateCheckedAt: new Date().toISOString() }
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
  const pending = workshopIds
    .map(workshopId => mods.find(item => item.workshopId === workshopId))
    .filter((mod): mod is (typeof mods)[number] => mod !== undefined && mod.installStatus !== 'ready')
  if (pending.length === 0) {
    return
  }
  // 这一批一起问一次工坊，避免每个 Mod 各打一次接口
  const workshopUpdatedAtMap = await fetchWorkshopUpdatedAtMap(pending.map(mod => mod.workshopId))
  // 清单同样只读一次：这批 Mod 共用同一份 appworkshop acf
  const installedItems = readWorkshopInstalledItems(input.installPath)
  for (const mod of pending) {
    const localVersion = resolveInstalledContentVersion(input.installPath, mod.workshopId, installedItems)
    const workshopUpdatedAt = workshopUpdatedAtMap.get(mod.workshopId) ?? null
    await upsertInstanceModFn({
      instanceId: input.instanceId,
      workshopId: mod.workshopId,
      name: resolvePersistedModName(input.installPath, mod.workshopId, mod.name),
      previewImage: mod.previewImage,
      enabled: mod.enabled,
      loadOrder: mod.loadOrder,
      version: mod.version,
      installStatus: 'ready',
      installError: null,
      localUpdatedAt: localVersion.updatedAt,
      loadedCopyStale: localVersion.loadedCopyStale,
      ...(workshopUpdatedAt
        ? { remoteUpdatedAt: workshopUpdatedAt, updateCheckedAt: new Date().toISOString() }
        : {}),
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
  fetchWorkshopModMetadata?: FetchWorkshopModMetadataFn
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
  if (hooks.fetchWorkshopModMetadata) {
    fetchWorkshopModMetadataFn = hooks.fetchWorkshopModMetadata
  }
}

export function resetModDownloadDbHooksForTest() {
  listInstanceModsFn = listInstanceMods
  getInstanceModByWorkshopIdFn = getInstanceModByWorkshopId
  upsertInstanceModFn = upsertInstanceMod
  updateInstanceModByWorkshopIdFn = updateInstanceModByWorkshopId
  fetchWorkshopModMetadataFn = fetchWorkshopModMetadata
}
