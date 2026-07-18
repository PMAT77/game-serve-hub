import DockerClient from 'dockerode'
import { resolveDockerConnectOptions } from '../docker-connect'
import { getServerContainerConfig } from '../../shared/config/container'
import { runSteamcmdJob } from './steamcmd-job'
import { buildSteamcmdAppUpdateArgs, buildSteamcmdWorkshopDownloadArgs } from './steamcmd-args'
import { resolveSteamcmdInstallBind } from './steamcmd-install-bind'
import { appendSteamcmdBindMountOptions, resolveSteamcmdContainerUser } from './steamcmd-container-user'
import { withSteamcmdAppUpdateLock } from './steamcmd-app-update-queue'
import { loadServerConfig, resolveInstallLogsDir } from '../../shared/config'
import { loadSteamcmdRuntimeConfig } from '../../shared/config/steamcmd'
import { appendInstallResourceSnapshot } from './install-resource-monitor'
import { formatSteamcmdMemoryLimitForLog, resolveSteamcmdContainerMemoryLimits } from './steamcmd-container-resources'
import { parseImageRef } from './image-ref'
import { DST_WORKSHOP_APP_ID } from '../game-adapter/dst/constants'

/** 未配置 SteamCMD 镜像时使用的官方默认仓库。 */
export const STEAMCMD_OFFICIAL_REPOSITORY = 'ghcr.io/gameserverhub/steamcmd-base'

const STEAMCMD_APP_UPDATE_TIMEOUT_MS = 30 * 60 * 1000
const STEAMCMD_APP_INFO_TIMEOUT_MS = 90_000
const DEFAULT_STEAMCMD_WORKSHOP_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

function resolveDocker() {
  const { dockerHost } = getServerContainerConfig()
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

function buildSteamcmdAppInfoArgs(appId: string) {
  return [
    '+@ShutdownOnFailedCommand',
    '1',
    '+@NoPromptForPassword',
    '1',
    '+login',
    'anonymous',
    '+app_info_update',
    '1',
    '+app_info_print',
    appId,
    '+quit',
  ]
}

export {
  cancelSteamcmdInstallContainer,
  cleanupAllRunningSteamcmdInstallContainers,
  cleanupOrphanedSteamcmdInstallContainers,
  isSteamcmdJobRunning,
} from './steamcmd-job'

export async function runSteamcmdAppUpdateInContainer(input: {
  hostInstallPath: string
  appId: string
  loginArgs: string[]
  cancelKey?: string
  onLogLine?: (line: string) => void
  onAwaitingSteamcmdLock?: () => void | Promise<void>
}): Promise<{ ok: boolean, output: string, cancelled?: boolean }> {
  const jobId = input.cancelKey?.trim() || 'anonymous'
  return withSteamcmdAppUpdateLock(
    jobId,
    () => runSteamcmdAppUpdateInContainerUnlocked(input),
    { onQueued: input.onAwaitingSteamcmdLock },
  )
}

async function runSteamcmdAppUpdateInContainerUnlocked(input: {
  hostInstallPath: string
  appId: string
  loginArgs: string[]
  cancelKey?: string
  onLogLine?: (line: string) => void
}): Promise<{ ok: boolean, output: string, cancelled?: boolean }> {
  const { steamcmdImage, instancesRoot } = getServerContainerConfig()
  const docker = resolveDocker()
  const bindPlan = await resolveSteamcmdInstallBind(docker, input.hostInstallPath, instancesRoot)
  const logLines: string[] = []
  const pushLine = (line: string) => {
    logLines.push(line)
    input.onLogLine?.(line)
  }

  pushLine(`准备启动 SteamCMD 容器（镜像 ${steamcmdImage}）`)
  pushLine(`安装目录（面板侧）: ${input.hostInstallPath}`)
  pushLine(`AppID: ${input.appId}`)
  pushLine(`SteamCMD bind 模式: ${bindPlan.mode}`)
  if (bindPlan.error) {
    pushLine(bindPlan.error)
    return {
      ok: false,
      output: logLines.slice(-20).join('\n') || bindPlan.error,
    }
  }
  if (bindPlan.mode === 'direct') {
    pushLine(`SteamCMD 直 bind: ${bindPlan.hostBinds[0]} → force_install_dir ${bindPlan.containerInstallPath}`)
  }
  else {
    pushLine(`SteamCMD 卷挂载: ${bindPlan.hostBinds[0]} → force_install_dir ${bindPlan.containerInstallPath}`)
  }

  const steamcmdConfig = loadSteamcmdRuntimeConfig()
  if (steamcmdConfig.downloadRegion) {
    pushLine(`Steam 下载区域：${steamcmdConfig.downloadRegion}`)
  }
  if (steamcmdConfig.httpProxy || steamcmdConfig.httpsProxy) {
    pushLine('SteamCMD 代理：已配置（HTTP/HTTPS）')
  }
  if (steamcmdConfig.networkMode === 'host') {
    pushLine('SteamCMD 网络模式：host')
  }

  const steamcmdArgs = buildSteamcmdAppUpdateArgs(
    bindPlan.containerInstallPath,
    input.appId,
    input.loginArgs,
    { downloadRegion: steamcmdConfig.downloadRegion || undefined },
  )

  const memoryLimits = resolveSteamcmdContainerMemoryLimits('app-update')
  pushLine(`SteamCMD 容器内存上限: ${formatSteamcmdMemoryLimitForLog(memoryLimits)}`)

  const instanceId = input.cancelKey?.trim()
  if (instanceId) {
    try {
      const installLogsDir = resolveInstallLogsDir(loadServerConfig().dbPath)
      const resourceLines = await appendInstallResourceSnapshot(installLogsDir, docker, {
        instanceId,
        phase: 'steamcmd_before',
      })
      for (const line of resourceLines) {
        pushLine(line)
      }
    }
    catch {
      pushLine('[资源快照] 写入失败（不影响安装继续）')
    }
  }

  const result = await runSteamcmdJob({
    image: steamcmdImage,
    cmd: [
      '/home/steam/steamcmd/steamcmd.sh',
      ...steamcmdArgs,
    ],
    hostBinds: bindPlan.hostBinds.map(appendSteamcmdBindMountOptions),
    user: resolveSteamcmdContainerUser(),
    jobId: input.cancelKey,
    kind: 'app-update',
    timeoutMs: STEAMCMD_APP_UPDATE_TIMEOUT_MS,
    onLogLine: input.onLogLine,
  })

  if (result.ok) {
    pushLine('SteamCMD app_update 已完成')
  }

  if (instanceId) {
    try {
      const installLogsDir = resolveInstallLogsDir(loadServerConfig().dbPath)
      const resourceLines = await appendInstallResourceSnapshot(installLogsDir, docker, {
        instanceId,
        phase: 'steamcmd_after',
        extra: {
          ok: result.ok,
          exitCode: result.exitCode,
          cancelled: result.cancelled ?? false,
          timedOut: result.timedOut ?? false,
          oomKilled: result.exitCode === 137,
        },
      })
      for (const line of resourceLines) {
        pushLine(line)
      }
      if (result.exitCode === 137) {
        pushLine('SteamCMD 容器可能因硬上限 OOM 被终止（exit 137）；可在 panel.env 酌情调高 GSH_STEAMCMD_CONTAINER_MEMORY_MB，并避免与运行中实例同时安装')
      }
    }
    catch {
      // ignore snapshot errors
    }
  }

  return {
    ok: result.ok,
    output: result.output || logLines.slice(-20).join('\n'),
    cancelled: result.cancelled,
  }
}

export async function runSteamcmdWorkshopDownloadInContainer(input: {
  hostInstallPath: string
  workshopIds: string[]
  cancelKey?: string
  onLogLine?: (line: string) => void
  onAwaitingSteamcmdLock?: () => void | Promise<void>
  onDownloadStart?: () => void | Promise<void>
  timeoutMs?: number
}): Promise<{ ok: boolean, output: string, cancelled?: boolean }> {
  const jobId = input.cancelKey?.trim() || 'anonymous'
  return withSteamcmdAppUpdateLock(
    jobId,
    () => runSteamcmdWorkshopDownloadInContainerUnlocked(input),
    { onQueued: input.onAwaitingSteamcmdLock },
  )
}

async function runSteamcmdWorkshopDownloadInContainerUnlocked(input: {
  hostInstallPath: string
  workshopIds: string[]
  cancelKey?: string
  onLogLine?: (line: string) => void
  onDownloadStart?: () => void | Promise<void>
  timeoutMs?: number
}): Promise<{ ok: boolean, output: string, cancelled?: boolean }> {
  const { steamcmdImage, instancesRoot } = getServerContainerConfig()
  const docker = resolveDocker()
  const bindPlan = await resolveSteamcmdInstallBind(docker, input.hostInstallPath, instancesRoot)
  const logLines: string[] = []
  const pushLine = (line: string) => {
    logLines.push(line)
    input.onLogLine?.(line)
  }

  const workshopIds = [...new Set(input.workshopIds.map(id => id.trim()).filter(Boolean))]
  if (workshopIds.length === 0) {
    return { ok: true, output: '' }
  }

  pushLine(`准备启动 SteamCMD 容器下载 Mod（镜像 ${steamcmdImage}）`)
  pushLine(`安装目录（面板侧）: ${input.hostInstallPath}`)
  pushLine(`Workshop AppID: ${DST_WORKSHOP_APP_ID}`)
  pushLine(`待下载 Mod 数量: ${workshopIds.length}`)
  pushLine(`SteamCMD bind 模式: ${bindPlan.mode}`)
  if (bindPlan.error) {
    pushLine(bindPlan.error)
    return {
      ok: false,
      output: logLines.slice(-20).join('\n') || bindPlan.error,
    }
  }

  const steamcmdConfig = loadSteamcmdRuntimeConfig()
  const steamcmdArgs = buildSteamcmdWorkshopDownloadArgs(
    bindPlan.containerInstallPath,
    DST_WORKSHOP_APP_ID,
    workshopIds,
    ['+login', 'anonymous'],
    { downloadRegion: steamcmdConfig.downloadRegion || undefined },
  )

  const memoryLimits = resolveSteamcmdContainerMemoryLimits('app-update')
  pushLine(`SteamCMD 容器内存上限: ${formatSteamcmdMemoryLimitForLog(memoryLimits)}`)

  await input.onDownloadStart?.()

  const result = await runSteamcmdJob({
    image: steamcmdImage,
    cmd: [
      '/home/steam/steamcmd/steamcmd.sh',
      ...steamcmdArgs,
    ],
    hostBinds: bindPlan.hostBinds.map(appendSteamcmdBindMountOptions),
    user: resolveSteamcmdContainerUser(),
    jobId: input.cancelKey,
    kind: 'app-update',
    timeoutMs: input.timeoutMs ?? DEFAULT_STEAMCMD_WORKSHOP_DOWNLOAD_TIMEOUT_MS,
    onLogLine: input.onLogLine,
  })

  if (result.ok) {
    pushLine('SteamCMD workshop_download_item 已完成')
  }

  return {
    ok: result.ok,
    output: result.output || logLines.slice(-20).join('\n'),
    cancelled: result.cancelled,
  }
}

export async function runSteamcmdAppInfoInContainer(appId: string): Promise<{ ok: boolean, output: string }> {
  const { steamcmdImage } = getServerContainerConfig()
  const result = await runSteamcmdJob({
    image: steamcmdImage,
    cmd: [
      '/home/steam/steamcmd/steamcmd.sh',
      ...buildSteamcmdAppInfoArgs(appId.trim()),
    ],
    kind: 'app-info',
    timeoutMs: STEAMCMD_APP_INFO_TIMEOUT_MS,
  })

  const output = result.output
  return {
    ok: (result.ok || /"appid"\s+"/i.test(output)) && !result.timedOut,
    output: output || (result.timedOut ? 'SteamCMD app_info 查询超时' : 'SteamCMD app_info 执行失败'),
  }
}

export type SteamcmdImagePullResult = { ok: true } | { ok: false, error: string }

let steamcmdImagePullInFlight: Promise<SteamcmdImagePullResult> | null = null

function normalizeMirrorRegistries(): string[] {
  const raw = (process.env.GSH_STEAMCMD_IMAGE_MIRRORS || '').trim()
  if (!raw) {
    return []
  }
  return [...new Set(
    raw
      .split(',')
      .map(item => item.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
      .filter(Boolean),
  )]
}

function buildImageRef(registry: string, repository: string, tag: string): string {
  if (registry === 'docker.io') {
    return `${repository}:${tag}`
  }
  return `${registry}/${repository}:${tag}`
}

function buildTagRepo(ref: string): { repo: string, tag: string } {
  const parsed = parseImageRef(ref)
  const repo = parsed.registry === 'docker.io'
    ? parsed.repository
    : `${parsed.registry}/${parsed.repository}`
  return { repo, tag: parsed.tag }
}

function formatSteamcmdPullError(raw: string, image: string, triedImages?: string[]): string {
  const text = raw.trim() || `拉取 ${image} 失败`
  const attempted = triedImages?.length ? `已尝试镜像：${triedImages.join(' -> ')}。` : ''
  if (/403 Forbidden|denied|unauthorized/i.test(text)) {
    return `${attempted}镜像仓库拒绝访问（403/unauthorized），请检查镜像可见性或更换可访问镜像。原始错误：${text}`
  }
  if (/registry-1\.docker\.io|docker\.io|connectex|ETIMEDOUT|timeout|deadline|ECONNREFUSED|failed to respond/i.test(text)) {
    return [
      attempted,
      `无法从镜像仓库拉取 SteamCMD 镜像 ${image}（网络超时或被阻断）。`,
      '可尝试：① 在可访问网络下手动 docker pull 后重试；',
      '② 确认可访问 GHCR（ghcr.io/gameserverhub/steamcmd-base）；',
      '③ 检查 panel.env 中 GSH_STEAMCMD_IMAGE 的 tag 是否与 GHCR 一致。',
      `原始错误：${text}`,
    ].join('')
  }
  if (/manifest unknown|not found|404/i.test(text)) {
    return `${attempted}镜像 ${image} 不存在或标签错误，请检查 GSH_STEAMCMD_IMAGE。原始错误：${text}`
  }
  return `${attempted}${text}`
}

async function pullSteamcmdImageOnce(steamcmdImage: string): Promise<void> {
  const docker = resolveDocker()
  await new Promise<void>((resolve, reject) => {
    docker.pull(steamcmdImage, (pullError: Error | null, stream: NodeJS.ReadableStream) => {
      if (pullError) {
        reject(pullError)
        return
      }
      docker.modem.followProgress(stream, (progressError: Error | null) => {
        if (progressError) {
          reject(progressError)
        }
        else {
          resolve()
        }
      })
    })
  })
}

async function isImagePresentByRef(imageRef: string): Promise<boolean> {
  try {
    const docker = resolveDocker()
    await docker.getImage(imageRef).inspect()
    return true
  }
  catch {
    return false
  }
}

async function tagImageAlias(sourceRef: string, targetRef: string): Promise<void> {
  if (sourceRef === targetRef) {
    return
  }
  const docker = resolveDocker()
  const { repo, tag } = buildTagRepo(targetRef)
  await docker.getImage(sourceRef).tag({ repo, tag })
}

/** 面板拉取目标（完整保留 panel.env 中的 GSH_STEAMCMD_IMAGE） */
export function resolvePanelSteamcmdPullRef(configuredImage?: string): string {
  const configured = (configuredImage ?? getServerContainerConfig().steamcmdImage).trim()
  return configured || `${STEAMCMD_OFFICIAL_REPOSITORY}:latest`
}

/**
 * SteamCMD 拉取候选：
 * 1) 若配置 GSH_STEAMCMD_IMAGE_MIRRORS，按顺序优先尝试候选 registry；
 * 2) 最后尝试完整的已配置镜像引用。
 */
export function buildSteamcmdImageCandidates(configuredImage?: string): string[] {
  const configuredRef = resolvePanelSteamcmdPullRef(configuredImage)
  const parsed = parseImageRef(configuredRef)
  const mirrors = normalizeMirrorRegistries().filter(registry => registry !== parsed.registry)
  const candidates = mirrors.map(registry => buildImageRef(registry, parsed.repository, parsed.tag))
  candidates.push(configuredRef)
  return candidates
}

export async function isSteamcmdImagePresent(): Promise<boolean> {
  try {
    const { steamcmdImage } = getServerContainerConfig()
    if (await isImagePresentByRef(steamcmdImage)) {
      return true
    }
    return false
  }
  catch {
    return false
  }
}

const STEAMCMD_PULL_MAX_ATTEMPTS = 3
const STEAMCMD_PULL_RETRY_BASE_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 仅由用户显式触发（POST .../steamcmd/install），禁止在页面加载/列表轮询中调用 */
export async function pullSteamcmdImage(): Promise<SteamcmdImagePullResult> {
  const { steamcmdImage } = getServerContainerConfig()
  if (await isImagePresentByRef(steamcmdImage)) {
    return { ok: true }
  }
  if (steamcmdImagePullInFlight) {
    return steamcmdImagePullInFlight
  }
  const candidates = buildSteamcmdImageCandidates(steamcmdImage)
  steamcmdImagePullInFlight = (async (): Promise<SteamcmdImagePullResult> => {
    for (const candidate of candidates) {
      if (await isImagePresentByRef(candidate)) {
        await tagImageAlias(candidate, steamcmdImage)
        return { ok: true }
      }
    }

    let lastError = ''
    const tried: string[] = []
    for (const candidate of candidates) {
      tried.push(candidate)
      for (let attempt = 1; attempt <= STEAMCMD_PULL_MAX_ATTEMPTS; attempt++) {
        try {
          await pullSteamcmdImageOnce(candidate)
          await tagImageAlias(candidate, steamcmdImage)
          return { ok: true }
        }
        catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          if (attempt < STEAMCMD_PULL_MAX_ATTEMPTS) {
            await sleep(STEAMCMD_PULL_RETRY_BASE_MS * attempt)
          }
        }
      }
    }
    return {
      ok: false,
      error: formatSteamcmdPullError(lastError, candidates[candidates.length - 1] || steamcmdImage, tried),
    }
  })().finally(() => {
    steamcmdImagePullInFlight = null
  })
  return steamcmdImagePullInFlight
}
