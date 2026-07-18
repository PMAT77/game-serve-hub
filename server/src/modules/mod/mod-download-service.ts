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
import { syncInstanceModFilesFromDb } from './mod-file-sync-service'
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
  const ordered = [...dependencyIds.filter(id => id !== workshopId)]
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

async function persistSubscribedMod(input: ModDownloadJobInput) {
  const { instanceId, installPath, payload } = input
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
    installStatus: 'ready',
    installError: null,
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

async function runModDownloadJob(input: ModDownloadJobInput, record: ModInstallJobRecord) {
  const workshopId = input.payload.workshopId.trim()
  const downloadIds = collectDownloadWorkshopIds(input.payload)
  const downloadResult = await modDownloadExecutor({
    hostInstallPath: input.installPath,
    workshopIds: downloadIds,
    instanceId: input.instanceId,
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
  await persistSubscribedMod(input)
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

    if (existingMod?.installStatus === 'ready' && filesReady) {
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
