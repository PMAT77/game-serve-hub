import type { FastifyInstance } from 'fastify'
import type {
  InstanceCheckUpdatesPayload,
  InstanceUpdateCheckJobPayload,
  InstanceUpdateStatusItem,
} from '../../../../shared/contracts/instance'
import fs from 'node:fs'
import process from 'node:process'
import type { InstallSeedDonor } from './install-seed'
import type { DbGameInstance } from '../../shared/db/index'
import {
  getGameInstanceById,
  getSystemPanelSettings,
  getSystemSteamcmdConfig,
  listGameInstances,
  updateGameInstanceRuntime,
} from '../../shared/db/index'
import { getDefaultPanelSettings } from '../system/defaults'
import { resolveDockerStatus } from '../../infra/docker'
import {
  checkGameUpdateAvailable,
  clearRemoteBuildCache,
  fetchRemoteBuildId,
  readLocalBuildId,
  writeLocalBuildId,
} from '../../shared/steam-update/build-id'

export const UPDATE_CHECK_STALE_MS = 60 * 60 * 1000
const PERIODIC_UPDATE_CHECK_MS = 6 * 60 * 60 * 1000
const LOCAL_NODE_ID = 'local-node'

let backgroundCheckRunning = false

export type InstanceCheckUpdatesResponse = InstanceCheckUpdatesPayload
export type InstanceUpdateCheckJobStatus = InstanceUpdateCheckJobPayload

let updateCheckJobStatus: InstanceUpdateCheckJobStatus = {
  checking: false,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
}

let updateCheckJobInFlight: Promise<void> | null = null

function cloneUpdateCheckJobStatus(): InstanceUpdateCheckJobStatus {
  return {
    ...updateCheckJobStatus,
    result: updateCheckJobStatus.result
      ? {
          ...updateCheckJobStatus.result,
          items: [...updateCheckJobStatus.result.items],
        }
      : null,
  }
}

export function getInstanceUpdateCheckJobStatus(): InstanceUpdateCheckJobStatus {
  return cloneUpdateCheckJobStatus()
}

export function enqueueInstanceUpdateCheck(input: {
  steamcmdCommand: string
  instanceIds?: string[]
  force?: boolean
  validateRuntime?: () => Promise<{ ok: boolean, message?: string }>
}): InstanceUpdateCheckJobStatus {
  if (updateCheckJobStatus.checking && updateCheckJobInFlight) {
    return getInstanceUpdateCheckJobStatus()
  }

  updateCheckJobStatus = {
    checking: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  }

  updateCheckJobInFlight = (async () => {
    try {
      if (input.validateRuntime) {
        const runtimeReady = await input.validateRuntime()
        if (!runtimeReady.ok) {
          updateCheckJobStatus.error = runtimeReady.message ?? '容器运行时未就绪，无法检查更新'
          return
        }
      }
      const result = await checkInstancesForUpdates({
        steamcmdCommand: input.steamcmdCommand,
        instanceIds: input.instanceIds,
        force: input.force ?? false,
      })
      updateCheckJobStatus.result = result
    }
    catch (error) {
      updateCheckJobStatus.error = error instanceof Error ? error.message : String(error)
    }
    finally {
      updateCheckJobStatus.checking = false
      updateCheckJobStatus.finishedAt = new Date().toISOString()
      updateCheckJobInFlight = null
    }
  })()

  return getInstanceUpdateCheckJobStatus()
}

export function isUpdateCheckStale(instance: Pick<DbGameInstance, 'updateCheckedAt'>): boolean {
  if (!instance.updateCheckedAt) {
    return true
  }
  const checkedAt = Date.parse(instance.updateCheckedAt)
  if (!Number.isFinite(checkedAt)) {
    return true
  }
  return Date.now() - checkedAt > UPDATE_CHECK_STALE_MS
}

export function canCheckInstanceUpdate(instance: Pick<DbGameInstance, 'status' | 'nodeId'>): boolean {
  if (instance.nodeId !== LOCAL_NODE_ID) {
    return false
  }
  if (instance.status === 'pending_install' || instance.status === 'installing') {
    return false
  }
  return true
}

export async function resolveSteamcmdCommandForUpdateCheck(): Promise<string> {
  const steamcmdConfig = await getSystemSteamcmdConfig()
  return steamcmdConfig?.steamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
}

export async function refreshInstanceUpdateStatus(
  instance: DbGameInstance,
  input: {
    steamcmdCommand: string
    forceRemote?: boolean
  },
): Promise<DbGameInstance> {
  if (!canCheckInstanceUpdate(instance)) {
    return instance
  }
  const installPath = instance.installPath?.trim()
  if (!installPath || !fs.existsSync(installPath)) {
    await updateGameInstanceRuntime(instance.id, {
      updateAvailable: false,
      localBuildId: null,
      remoteBuildId: null,
      updateCheckedAt: new Date().toISOString(),
    })
    return (await getGameInstanceById(instance.id)) ?? instance
  }
  if (input.forceRemote) {
    clearRemoteBuildCache(instance.gameCode)
  }
  const result = await checkGameUpdateAvailable({
    installPath,
    appId: instance.gameCode,
    steamcmdCommand: input.steamcmdCommand,
    forceRemote: input.forceRemote,
  })
  await updateGameInstanceRuntime(instance.id, {
    updateAvailable: result.updateAvailable,
    localBuildId: result.localBuildId,
    remoteBuildId: result.remoteBuildId,
    updateCheckedAt: result.checkedAt,
  })
  const updated = await getGameInstanceById(instance.id)
  return updated ?? instance
}

function toStatusItem(instance: DbGameInstance, message?: string): InstanceUpdateStatusItem {
  return {
    id: instance.id,
    name: instance.name,
    updateAvailable: instance.updateAvailable,
    localBuildId: instance.localBuildId,
    remoteBuildId: instance.remoteBuildId,
    updateCheckedAt: instance.updateCheckedAt,
    message,
  }
}

export async function checkInstancesForUpdates(input: {
  steamcmdCommand: string
  instanceIds?: string[]
  force?: boolean
}): Promise<InstanceCheckUpdatesResponse> {
  const all = await listGameInstances()
  const idSet = input.instanceIds?.length
    ? new Set(input.instanceIds.map(id => id.trim()).filter(Boolean))
    : null
  const targets = all.filter((item) => {
    if (!canCheckInstanceUpdate(item)) {
      return false
    }
    if (idSet && !idSet.has(item.id)) {
      return false
    }
    return true
  })
  const items: InstanceUpdateStatusItem[] = []
  const uniqueAppIds = [...new Set(targets.map(item => item.gameCode.trim()).filter(Boolean))]
  const forceRemote = input.force ?? false
  if (forceRemote) {
    for (const appId of uniqueAppIds) {
      clearRemoteBuildCache(appId)
    }
  }
  const remoteBuildByAppId = new Map<string, string | null>()
  for (const appId of uniqueAppIds) {
    remoteBuildByAppId.set(
      appId,
      await fetchRemoteBuildId(input.steamcmdCommand, appId, { force: forceRemote }),
    )
  }
  for (const instance of targets) {
    const installPath = instance.installPath?.trim()
    if (!installPath || !fs.existsSync(installPath)) {
      await updateGameInstanceRuntime(instance.id, {
        updateAvailable: false,
        localBuildId: null,
        remoteBuildId: null,
        updateCheckedAt: new Date().toISOString(),
      })
      const updated = await getGameInstanceById(instance.id)
      items.push(toStatusItem(updated ?? instance))
      continue
    }
    const localBuildId = readLocalBuildId(installPath, instance.gameCode)
    const remoteBuildId = remoteBuildByAppId.get(instance.gameCode) ?? null
    const checkedAt = new Date().toISOString()
    const updateAvailable = Boolean(
      localBuildId
      && remoteBuildId
      && localBuildId !== remoteBuildId,
    )
    await updateGameInstanceRuntime(instance.id, {
      updateAvailable,
      localBuildId,
      remoteBuildId,
      updateCheckedAt: checkedAt,
    })
    const updated = await getGameInstanceById(instance.id)
    items.push(toStatusItem(updated ?? instance))
  }
  return {
    items,
    updateAvailableCount: items.filter(item => item.updateAvailable).length,
  }
}

export async function refreshStaleInstanceUpdateChecks(
  app: FastifyInstance,
  instances: DbGameInstance[],
  steamcmdCommand: string,
) {
  if (backgroundCheckRunning) {
    return
  }
  const stale = instances.filter(item => canCheckInstanceUpdate(item) && isUpdateCheckStale(item))
  if (stale.length === 0) {
    return
  }
  backgroundCheckRunning = true
  try {
    for (const instance of stale.slice(0, 8)) {
      try {
        await refreshInstanceUpdateStatus(instance, { steamcmdCommand })
      }
      catch (error) {
        app.log.warn({
          instanceId: instance.id,
          err: error,
        }, '后台检查实例更新失败')
      }
    }
  }
  finally {
    backgroundCheckRunning = false
  }
}

export function scheduleInstanceUpdateChecks(app: FastifyInstance) {
  const run = async () => {
    try {
      if ((await resolveDockerStatus()) !== 'running') {
        app.log.debug('Docker 未运行，跳过定时游戏服务端更新检查')
        return
      }
      const steamcmdCommand = await resolveSteamcmdCommandForUpdateCheck()
      const instances = await listGameInstances()
      await checkInstancesForUpdates({
        steamcmdCommand,
        force: false,
      })
      app.log.debug({
        checked: instances.length,
      }, '定时检查游戏服务端更新完成')
    }
    catch (error) {
      app.log.warn({ err: error }, '定时检查游戏服务端更新失败')
    }
  }
  setTimeout(() => void run(), 30_000)
  setInterval(() => void run(), PERIODIC_UPDATE_CHECK_MS)
}

export async function refreshInstanceUpdateStatusAfterSeed(
  instanceId: string,
  installPath: string,
  appId: string,
  donor: InstallSeedDonor,
) {
  const checkedAt = new Date().toISOString()
  const localBuildId = readLocalBuildId(installPath, appId) ?? donor.localBuildId
  const remoteBuildId = donor.remoteBuildId ?? donor.localBuildId
  await updateGameInstanceRuntime(instanceId, {
    updateAvailable: false,
    localBuildId,
    remoteBuildId,
    updateCheckedAt: checkedAt,
  })
}

export async function refreshInstanceUpdateStatusAfterInstall(
  instanceId: string,
  installPath: string,
  appId: string,
  steamcmdCommand: string,
) {
  clearRemoteBuildCache(appId)
  const checkedAt = new Date().toISOString()
  const remoteBuildId = await fetchRemoteBuildId(steamcmdCommand, appId, { force: true })
  let localBuildId = readLocalBuildId(installPath, appId)

  if (remoteBuildId && localBuildId !== remoteBuildId) {
    if (writeLocalBuildId(installPath, appId, remoteBuildId)) {
      localBuildId = remoteBuildId
    }
  }

  await updateGameInstanceRuntime(instanceId, {
    updateAvailable: Boolean(
      localBuildId
      && remoteBuildId
      && localBuildId !== remoteBuildId,
    ),
    localBuildId,
    remoteBuildId,
    updateCheckedAt: checkedAt,
  })
}

/** 是否需要在发起更新前调用 SteamCMD 拉远端版本（避免 /update 接口阻塞数十秒） */
export function needsRemoteUpdatePrecheck(
  instance: Pick<DbGameInstance, 'updateAvailable' | 'remoteBuildId'>,
  localBuildId: string | null,
): boolean {
  if (instance.updateAvailable) {
    return false
  }
  if (!localBuildId || !instance.remoteBuildId) {
    return true
  }
  return localBuildId === instance.remoteBuildId
}

export async function resolveCheckUpdateBeforeStartEnabled(): Promise<boolean> {
  const settings = await getSystemPanelSettings()
  return settings?.checkUpdateBeforeStart
    ?? getDefaultPanelSettings().checkUpdateBeforeStart
}

/**
 * 启动前向 Steam 拉取远端 Build ID；若开启系统设置且存在更新则返回拦截文案。
 */
export async function resolveStartBlockedByPendingUpdate(
  instance: DbGameInstance,
): Promise<string | undefined> {
  if (!await resolveCheckUpdateBeforeStartEnabled()) {
    return undefined
  }
  if (!canCheckInstanceUpdate(instance)) {
    return undefined
  }
  const installPath = instance.installPath?.trim()
  if (!installPath || !fs.existsSync(installPath)) {
    return undefined
  }
  const steamcmdCommand = await resolveSteamcmdCommandForUpdateCheck()
  const updated = await refreshInstanceUpdateStatus(instance, {
    steamcmdCommand,
    forceRemote: true,
  })
  if (!updated.updateAvailable) {
    return undefined
  }
  const local = updated.localBuildId ?? '未知'
  const remote = updated.remoteBuildId ?? '未知'
  return `检测到 Steam 服务端有新版本（本地 Build ${local}，最新 Build ${remote}），请先在实例页点击「更新服务端」后再启动`
}
