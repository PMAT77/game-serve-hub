import type { FastifyInstance } from 'fastify'
import process from 'node:process'
import type { DbInstallLogStatus } from '../../shared/db/index'
import {
  listGameInstances,
  updateGameInstanceRuntime,
} from '../../shared/db/index'
import { loadServerConfig, resolveInstallLogsDir } from '../../shared/config'
import {
  InstanceInstallLogWriter,
} from '../../shared/instance-install/log-store'
import { parseSteamcmdProgressPercent } from '../../shared/instance-install/log-format'
import {
  cancelSteamcmdInstallContainer,
  cleanupOrphanedSteamcmdInstallContainers,
  isSteamcmdJobRunning,
  runSteamcmdAppUpdateInContainer,
} from '../../infra/container'
import { formatSteamcmdAppUpdateFailureMessage } from '../../infra/container/steamcmd-errors'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { diagnoseDstInstallReadiness } from '../../infra/game-adapter/dst/install-readiness'
import { ensureDstLayout } from '../../infra/game-adapter/dst/cluster-config'
import { prepareInstallPathForSteamcmd } from './install-path'
import { ensureGameRuntimeImageReady } from '../../infra/game-adapter/runtime-image'
import { refreshInstanceUpdateStatusAfterInstall } from './update-check'

export interface InstanceInstallJobInput {
  instanceId: string
  appId: string
  instanceName: string
  gamePort?: number | null
  installPath: string
  steamcmdCommand: string
  steamcmdCredentials?: { username: string, password: string }
}

const LOCAL_NODE_ID = 'local-node'

export const INSTALL_INTERRUPTED_MESSAGE = '安装已中断。请点击「更新服务端」重试，或删除实例后重建。'
export const INSTALL_RESTART_INTERRUPTED_MESSAGE = '服务重启导致安装中断，请点击「更新服务端」重新拉取。'

const installingInstanceIds = new Set<string>()
const cancelledInstallInstanceIds = new Set<string>()

export function isInstallJobActive(instanceId: string): boolean {
  return installingInstanceIds.has(instanceId)
}

export function getInstallLogsDirPath() {
  return resolveInstallLogsDir(loadServerConfig().dbPath)
}

export function getSteamcmdLoginCredentials(): {
  username: string
  password: string
} | undefined {
  const username = process.env.STEAMCMD_USERNAME?.trim() ?? ''
  const password = process.env.STEAMCMD_PASSWORD?.trim() ?? ''
  if (!username || !password) {
    return undefined
  }
  return { username, password }
}

function isInstallCancelled(instanceId: string): boolean {
  return cancelledInstallInstanceIds.has(instanceId)
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

export async function markInstallInterrupted(
  instanceId: string,
  logWriter: InstanceInstallLogWriter,
  detail?: string,
) {
  logWriter.appendLine(detail ?? '安装已由用户中断')
  await cancelSteamcmdInstallContainer(instanceId)
  void cleanupOrphanedSteamcmdInstallContainers(instanceId)
  await writeInstallLogMeta(instanceId, 'failed', null)
  await updateGameInstanceRuntime(instanceId, {
    status: 'error',
    lastCommand: null,
    lastError: detail ?? INSTALL_INTERRUPTED_MESSAGE,
    installPercent: null,
  })
}

export function shouldAllowInstallDespiteUpToDate(input: {
  status: string
  gameCode: string
  updateAvailable?: boolean | null
}, installPath: string, force?: boolean): boolean {
  if (force) {
    return true
  }
  if (input.status === 'error') {
    return true
  }
  if (input.gameCode.trim() === DST_APP_ID) {
    const readiness = diagnoseDstInstallReadiness(installPath)
    if (!readiness.ready) {
      return true
    }
  }
  return false
}

export function mapDbInstallLogStatusToResponse(
  installLogStatus: DbInstallLogStatus | null,
  instanceStatus: string,
): 'success' | 'failed' | 'running' | 'unknown' {
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

async function finalizeSuccessfulInstall(
  input: InstanceInstallJobInput,
  logWriter: InstanceInstallLogWriter,
  mode: 'anonymous' | 'account',
) {
  logWriter.appendLine(`安装完成（${mode}）`)
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
  let runtimeImageResult: Awaited<ReturnType<typeof ensureGameRuntimeImageReady>> | undefined
  if (startScriptResult.ok) {
    logWriter.appendLine('正在准备游戏运行环境镜像（首次可能需数分钟）…')
    runtimeImageResult = await ensureGameRuntimeImageReady(input.appId)
    if (runtimeImageResult.ok) {
      logWriter.appendLine('游戏运行环境镜像已就绪')
    }
    else {
      logWriter.appendLine(`游戏运行环境镜像准备失败（不影响已下载的游戏文件）：${runtimeImageResult.error}`)
    }
    await refreshInstanceUpdateStatusAfterInstall(
      input.instanceId,
      input.installPath,
      input.appId,
      input.steamcmdCommand,
    )
  }
  const runtimeImageFailed = startScriptResult.ok && runtimeImageResult !== undefined && !runtimeImageResult.ok
  const runtimeHint = runtimeImageFailed
    ? '；运行环境镜像未就绪，启动时将自动重试拉取'
    : ''
  await writeInstallLogMeta(input.instanceId, startScriptResult.ok ? 'success' : 'failed', startScriptResult.ok ? 100 : null)
  await updateGameInstanceRuntime(input.instanceId, {
    status: startScriptResult.ok ? 'stopped' : 'error',
    lastCommand: startScriptResult.ok
      ? `安装完成（${mode}），启动脚本已生成${runtimeHint}`
      : `安装完成（${mode}），启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`,
    lastError: startScriptResult.ok
      ? (runtimeImageFailed ? '运行环境镜像未就绪，启动实例时将自动重试拉取' : null)
      : startScriptResult.message ?? null,
    installPercent: startScriptResult.ok ? 100 : null,
  })
}

async function runInstallPipeline(
  input: InstanceInstallJobInput,
  logWriter: InstanceInstallLogWriter,
) {
  const updateProgress = async (line: string) => {
    logWriter.appendLine(line)
    const progressPercent = parseSteamcmdProgressPercent(line)
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

  if (isInstallCancelled(input.instanceId)) {
    await markInstallInterrupted(input.instanceId, logWriter)
    return
  }

  const pathError = prepareInstallPathForSteamcmd(input.installPath)
  if (pathError) {
    logWriter.appendLine(pathError)
    await writeInstallLogMeta(input.instanceId, 'failed', null)
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'error',
      lastCommand: null,
      lastError: pathError,
    })
    return
  }

  logWriter.appendLine('安装任务启动（已调整安装目录为 SteamCMD 容器用户可写）')
  await writeInstallLogMeta(input.instanceId, 'running', null)
  await updateGameInstanceRuntime(input.instanceId, {
    status: 'installing',
    lastCommand: '正在启动 SteamCMD 安装任务...',
    lastError: null,
    installPercent: null,
  })

  const isDst = input.appId.trim() === DST_APP_ID
  const preferAccountFirst = isDst && Boolean(input.steamcmdCredentials)

  if (isDst && !input.steamcmdCredentials) {
    logWriter.appendLine(
      '提示：饥荒联机版（343050）为 Steam 免费游戏，匿名安装常会失败；建议在 panel.env 配置 STEAMCMD_USERNAME / STEAMCMD_PASSWORD 后重试。',
    )
  }

  let anonymousResult: Awaited<ReturnType<typeof runSteamcmdAppUpdateInContainer>> | undefined
  let accountResult: Awaited<ReturnType<typeof runSteamcmdAppUpdateInContainer>> | undefined

  const runAccountInstall = async () => {
    if (!input.steamcmdCredentials) {
      return undefined
    }
    if (isInstallCancelled(input.instanceId)) {
      return { cancelled: true as const, ok: false, output: '' }
    }
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: preferAccountFirst
        ? '正在使用 Steam 账号登录安装...'
        : 'anonymous 失败，正在尝试账号登录重试...',
      lastError: null,
    })
    if (!preferAccountFirst) {
      logWriter.appendLine('anonymous 失败，正在尝试账号登录重试...')
    }
    else {
      logWriter.appendLine('正在使用 Steam 账号登录安装（343050）...')
    }
    return runSteamcmdAppUpdateInContainer({
      hostInstallPath: input.installPath,
      appId: input.appId,
      loginArgs: ['+login', input.steamcmdCredentials.username, input.steamcmdCredentials.password],
      cancelKey: input.instanceId,
      onLogLine: line => void updateProgress(line),
    })
  }

  const runAnonymousInstall = async () => {
    if (isInstallCancelled(input.instanceId)) {
      return { cancelled: true as const, ok: false, output: '' }
    }
    return runSteamcmdAppUpdateInContainer({
      hostInstallPath: input.installPath,
      appId: input.appId,
      loginArgs: ['+login', 'anonymous'],
      cancelKey: input.instanceId,
      onLogLine: line => void updateProgress(line),
    })
  }

  if (preferAccountFirst) {
    accountResult = await runAccountInstall()
    if (accountResult?.cancelled || isInstallCancelled(input.instanceId)) {
      await markInstallInterrupted(input.instanceId, logWriter)
      return
    }
    if (accountResult?.ok) {
      await finalizeSuccessfulInstall(input, logWriter, 'account')
      return
    }
    anonymousResult = await runAnonymousInstall()
  }
  else {
    anonymousResult = await runAnonymousInstall()
    if (anonymousResult.cancelled || isInstallCancelled(input.instanceId)) {
      await markInstallInterrupted(input.instanceId, logWriter)
      return
    }
    if (anonymousResult.ok) {
      await finalizeSuccessfulInstall(input, logWriter, 'anonymous')
      return
    }
    if (!input.steamcmdCredentials) {
      const failureMessage = formatSteamcmdAppUpdateFailureMessage({
        appId: input.appId,
        output: anonymousResult.output,
        mode: 'anonymous',
        hasAccountCredentials: false,
      })
      logWriter.appendLine(failureMessage)
      await writeInstallLogMeta(input.instanceId, 'failed', null)
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'error',
        lastCommand: null,
        lastError: failureMessage,
      })
      return
    }
    accountResult = await runAccountInstall()
  }

  if (accountResult?.cancelled || anonymousResult?.cancelled || isInstallCancelled(input.instanceId)) {
    await markInstallInterrupted(input.instanceId, logWriter)
    return
  }
  if (accountResult?.ok) {
    await finalizeSuccessfulInstall(input, logWriter, 'account')
    return
  }

  const anonymousDetail = formatSteamcmdAppUpdateFailureMessage({
    appId: input.appId,
    output: anonymousResult?.output ?? '',
    mode: 'anonymous',
    hasAccountCredentials: Boolean(input.steamcmdCredentials),
  })
  const accountDetail = accountResult
    ? formatSteamcmdAppUpdateFailureMessage({
        appId: input.appId,
        output: accountResult.output,
        mode: 'account',
        hasAccountCredentials: true,
      })
    : ''
  const combined = accountDetail
    ? `安装失败。\n--- anonymous ---\n${anonymousDetail}\n--- account ---\n${accountDetail}`
    : `安装失败。\n--- account ---\n${accountDetail || anonymousDetail}`
  logWriter.appendLine(combined)
  await writeInstallLogMeta(input.instanceId, 'failed', null)
  await updateGameInstanceRuntime(input.instanceId, {
    status: 'error',
    lastCommand: null,
    lastError: combined,
  })
}

async function runInstallJobInBackground(
  app: FastifyInstance,
  input: InstanceInstallJobInput,
  logWriter: InstanceInstallLogWriter,
) {
  try {
    await runInstallPipeline(input, logWriter)
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

/** 启动安装/更新任务；重试时会清除取消标记 */
export function startInstallJob(
  app: FastifyInstance,
  input: InstanceInstallJobInput,
): 'started' | 'busy' {
  if (installingInstanceIds.has(input.instanceId)) {
    return 'busy'
  }
  cancelledInstallInstanceIds.delete(input.instanceId)
  installingInstanceIds.add(input.instanceId)
  const logWriter = new InstanceInstallLogWriter(getInstallLogsDirPath(), input.instanceId)
  logWriter.clear()
  void runInstallJobInBackground(app, input, logWriter)
    .finally(() => {
      installingInstanceIds.delete(input.instanceId)
    })
  return 'started'
}

export async function cancelInstallJob(instanceId: string): Promise<void> {
  cancelledInstallInstanceIds.add(instanceId)
  await cancelSteamcmdInstallContainer(instanceId)
  installingInstanceIds.delete(instanceId)
  const logWriter = new InstanceInstallLogWriter(getInstallLogsDirPath(), instanceId)
  await markInstallInterrupted(instanceId, logWriter)
}

export function clearInstallJobTracking(instanceId: string): void {
  cancelledInstallInstanceIds.delete(instanceId)
  installingInstanceIds.delete(instanceId)
}

/**
 * 面板重启后 DB 可能仍为 installing，但内存任务已丢失。
 */
export async function reconcileStaleInstallingInstances(app: FastifyInstance): Promise<number> {
  const instances = await listGameInstances({ status: 'installing' })
  let reconciled = 0
  for (const instance of instances) {
    if (instance.nodeId !== LOCAL_NODE_ID) {
      continue
    }
    if (installingInstanceIds.has(instance.id)) {
      continue
    }
    if (await isSteamcmdJobRunning(instance.id)) {
      continue
    }
    await updateGameInstanceRuntime(instance.id, {
      status: 'error',
      installLogStatus: 'failed',
      lastCommand: null,
      lastError: INSTALL_RESTART_INTERRUPTED_MESSAGE,
      installPercent: null,
    })
    reconciled++
    app.log.info({ instanceId: instance.id }, '安装任务已中断（服务重启或任务丢失），已同步为异常')
  }
  return reconciled
}
