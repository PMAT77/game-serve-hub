import type { FastifyInstance } from 'fastify'
import DockerClient from 'dockerode'
import fs from 'node:fs'
import path from 'node:path'
import { pullGameDstImage } from '../../infra/container'
import {
  buildRegistryManifestUrl,
  normalizeDigest,
  parseImageRef,
  shortDigest,
} from '../../infra/container/image-ref'
import { resolveDockerConnectOptions } from '../../infra/docker-connect'
import { loadServerConfig } from '../../shared/config'
import { getSystemPanelSettings } from '../../shared/db/index'
import { getDefaultPanelSettings } from './defaults'

export interface HubImageUpdateInfo {
  image: string
  tag: string
  releaseVersion: string | null
  localDigest: string | null
  localDigestShort: string | null
  remoteDigest: string | null
  remoteDigestShort: string | null
  updateAvailable: boolean
  localPresent: boolean
  checkError: string | null
}

export interface GitHubReleaseSummary {
  tagName: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
}

export interface PanelUpdateStatus {
  panel: HubImageUpdateInfo
  dst: HubImageUpdateInfo
  release: GitHubReleaseSummary | null
  lastCheckedAt: string | null
  checking: boolean
  updating: boolean
  applySupported: boolean
  applyHint: string | null
  manualUpdateCommand: string | null
  checkError: string | null
}

const DEFAULT_CHECK_INTERVAL_HOURS = 1
const UPDATER_IMAGE = 'docker:27-cli'
const UPDATER_CONTAINER_NAME = 'game-server-hub-updater'

let cachedStatus: PanelUpdateStatus | null = null
let checkInFlight: Promise<PanelUpdateStatus> | null = null
let updating = false
let schedulerStarted = false
let schedulerTimer: NodeJS.Timeout | null = null

function normalizeErrorMessages(messages: Array<string | null | undefined>): string | null {
  const normalized = messages
    .flatMap((message) => {
      return String(message ?? '')
        .split(/[；;\n]+/)
        .map(item => item.trim())
        .filter(Boolean)
    })
  if (normalized.length === 0) {
    return null
  }
  return [...new Set(normalized)].join('；')
}

function resolveDocker() {
  const { dockerHost } = loadServerConfig()
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

function resolveReleaseVersionFromEnv(): string | null {
  const config = loadServerConfig()
  if (config.releaseVersion) {
    return config.releaseVersion
  }
  return null
}

async function inspectLocalImageDigest(image: string): Promise<{
  digest: string | null
  present: boolean
  releaseVersion: string | null
}> {
  try {
    const info = await resolveDocker().getImage(image).inspect() as {
      Id?: string
      RepoDigests?: string[]
      Config?: { Labels?: Record<string, string> }
    }
    const repoDigest = info.RepoDigests?.find(item => item.includes('@sha256:'))
    const digest = normalizeDigest(
      repoDigest?.split('@')[1]
      ?? info.Id,
    )
    const labelVersion = info.Config?.Labels?.['org.opencontainers.image.version']
    return {
      digest,
      present: true,
      releaseVersion: labelVersion?.trim() || null,
    }
  }
  catch {
    return {
      digest: null,
      present: false,
      releaseVersion: null,
    }
  }
}

async function fetchRemoteImageDigest(image: string): Promise<string | null> {
  const parsed = parseImageRef(image)
  const response = await fetch(buildRegistryManifestUrl(parsed), {
    method: 'HEAD',
    headers: {
      Accept: [
        'application/vnd.oci.image.index.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.v2+json',
      ].join(', '),
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`Registry 返回 ${response.status}`)
  }
  const digest = response.headers.get('docker-content-digest')
    ?? response.headers.get('Docker-Content-Digest')
  return normalizeDigest(digest)
}

async function fetchLatestGitHubRelease(repo: string): Promise<GitHubReleaseSummary | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'game-server-hub-panel-update',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`GitHub API 返回 ${response.status}`)
    }
    const json = await response.json() as {
      tag_name?: string
      name?: string
      body?: string
      published_at?: string
      html_url?: string
    }
    if (!json.tag_name) {
      return null
    }
    return {
      tagName: json.tag_name,
      name: json.name?.trim() || json.tag_name,
      body: json.body?.trim() || '',
      publishedAt: json.published_at || '',
      htmlUrl: json.html_url || '',
    }
  }
  catch {
    return null
  }
}

function buildManualUpdateCommand(): string {
  const config = loadServerConfig()
  const composeArgs = config.composeFiles.map(file => `-f ${file}`).join(' ')
  return [
    `cd ${config.stackDir || '/opt/game-server-hub'}`,
    `docker compose --env-file panel.env ${composeArgs} pull`,
    `docker compose --env-file panel.env ${composeArgs} up -d`,
  ].join(' && ')
}

function resolveApplySupport(): { supported: boolean, hint: string | null } {
  const config = loadServerConfig()
  if (!config.stackDir) {
    return {
      supported: false,
      hint: '未配置 GSH_STACK_DIR，无法一键更新面板。请在 panel.env 中设置后重启面板，或使用下方手动命令。',
    }
  }
  if (!path.isAbsolute(config.stackDir)) {
    return {
      supported: false,
      hint: 'GSH_STACK_DIR 必须是绝对路径。',
    }
  }
  for (const composeFile of config.composeFiles) {
    const composePath = path.join(config.stackDir, composeFile)
    if (!fs.existsSync(composePath)) {
      return {
        supported: false,
        hint: `缺少 compose 文件：${composePath}`,
      }
    }
  }
  const envPath = path.join(config.stackDir, 'panel.env')
  if (!fs.existsSync(envPath)) {
    return {
      supported: false,
      hint: `缺少环境文件：${envPath}`,
    }
  }
  return {
    supported: true,
    hint: null,
  }
}

async function buildImageUpdateInfo(
  image: string,
  fallbackReleaseVersion: string | null,
): Promise<HubImageUpdateInfo> {
  const parsed = parseImageRef(image)
  let localDigest: string | null = null
  let remoteDigest: string | null = null
  let localPresent = false
  let releaseVersion = fallbackReleaseVersion
  let checkError: string | null = null

  try {
    const local = await inspectLocalImageDigest(image)
    localDigest = local.digest
    localPresent = local.present
    releaseVersion = local.releaseVersion || releaseVersion
  }
  catch (error) {
    checkError = normalizeErrorMessages([
      checkError,
      error instanceof Error ? error.message : String(error),
    ])
  }

  try {
    remoteDigest = await fetchRemoteImageDigest(image)
  }
  catch (error) {
    checkError = normalizeErrorMessages([
      checkError,
      error instanceof Error ? error.message : String(error),
    ])
  }

  const updateAvailable = Boolean(
    remoteDigest
    && (!localDigest || localDigest !== remoteDigest),
  )

  return {
    image,
    tag: parsed.tag,
    releaseVersion,
    localDigest,
    localDigestShort: shortDigest(localDigest),
    remoteDigest,
    remoteDigestShort: shortDigest(remoteDigest),
    updateAvailable,
    localPresent,
    checkError,
  }
}

function buildEmptyStatus(): PanelUpdateStatus {
  const config = loadServerConfig()
  const applySupport = resolveApplySupport()
  const emptyImage = (image: string): HubImageUpdateInfo => ({
    image,
    tag: parseImageRef(image).tag,
    releaseVersion: null,
    localDigest: null,
    localDigestShort: null,
    remoteDigest: null,
    remoteDigestShort: null,
    updateAvailable: false,
    localPresent: false,
    checkError: null,
  })
  return {
    panel: emptyImage(config.panelImage),
    dst: emptyImage(config.gameDstImage),
    release: null,
    lastCheckedAt: null,
    checking: false,
    updating,
    applySupported: applySupport.supported,
    applyHint: applySupport.hint,
    manualUpdateCommand: buildManualUpdateCommand(),
    checkError: null,
  }
}

export function getCachedPanelUpdateStatus(): PanelUpdateStatus {
  return cachedStatus ?? buildEmptyStatus()
}

export async function refreshPanelUpdateStatus(): Promise<PanelUpdateStatus> {
  if (checkInFlight) {
    return checkInFlight
  }

  checkInFlight = (async () => {
    const config = loadServerConfig()
    const applySupport = resolveApplySupport()
    const envReleaseVersion = resolveReleaseVersionFromEnv()
    const [panel, dst, release] = await Promise.all([
      buildImageUpdateInfo(config.panelImage, envReleaseVersion),
      buildImageUpdateInfo(config.gameDstImage, envReleaseVersion),
      fetchLatestGitHubRelease(config.githubRepo),
    ])

    const checkErrors = normalizeErrorMessages([panel.checkError, dst.checkError])
    const nextStatus: PanelUpdateStatus = {
      panel,
      dst,
      release,
      lastCheckedAt: new Date().toISOString(),
      checking: false,
      updating,
      applySupported: applySupport.supported,
      applyHint: applySupport.hint,
      manualUpdateCommand: buildManualUpdateCommand(),
      checkError: checkErrors,
    }
    cachedStatus = nextStatus
    return nextStatus
  })().finally(() => {
    checkInFlight = null
  })

  if (cachedStatus) {
    cachedStatus = {
      ...cachedStatus,
      checking: true,
      updating,
    }
  }
  return checkInFlight
}

function buildComposeCommand(action: 'pull' | 'up'): string {
  const config = loadServerConfig()
  const composeArgs = config.composeFiles.map(file => `-f /stack/${file}`).join(' ')
  if (action === 'pull') {
    return `docker compose --env-file /stack/panel.env ${composeArgs} pull panel`
  }
  return `docker compose --env-file /stack/panel.env ${composeArgs} up -d panel`
}

async function startPanelComposeUpdater(): Promise<void> {
  const config = loadServerConfig()
  const applySupport = resolveApplySupport()
  if (!applySupport.supported || !config.stackDir) {
    throw new Error(applySupport.hint || '当前环境不支持一键更新面板')
  }

  const docker = resolveDocker()
  try {
    const existing = docker.getContainer(UPDATER_CONTAINER_NAME)
    await existing.inspect()
    await existing.remove({ force: true })
  }
  catch {
    // no existing updater
  }

  const shellCommand = [
    buildComposeCommand('pull'),
    buildComposeCommand('up'),
  ].join(' && ')

  await docker.createContainer({
    name: UPDATER_CONTAINER_NAME,
    Image: UPDATER_IMAGE,
    Cmd: ['sh', '-c', shellCommand],
    HostConfig: {
      AutoRemove: true,
      Binds: [
        '/var/run/docker.sock:/var/run/docker.sock',
        `${config.stackDir}:/stack:ro`,
      ],
    },
  }).then(container => container.start())
}

export async function applyPanelUpdates(
  targets?: Array<'panel' | 'dst'>,
): Promise<{ status: 'updating' | 'completed', message: string, applied: Array<'panel' | 'dst'> }> {
  if (updating) {
    throw new Error('更新正在进行中，请稍后再试')
  }

  const status = cachedStatus ?? await refreshPanelUpdateStatus()
  const requested = targets?.length
    ? targets
    : (['panel', 'dst'] as Array<'panel' | 'dst'>).filter((target) => {
      return target === 'panel' ? status.panel.updateAvailable : status.dst.updateAvailable
    })

  if (requested.length === 0) {
    return {
      status: 'completed',
      message: '当前已是最新版本',
      applied: [],
    }
  }

  const applied: Array<'panel' | 'dst'> = []

  if (requested.includes('dst')) {
    const pullResult = await pullGameDstImage({ force: true })
    if (!pullResult.ok) {
      throw new Error(pullResult.error)
    }
    applied.push('dst')
  }

  if (requested.includes('panel')) {
    updating = true
    if (cachedStatus) {
      cachedStatus = { ...cachedStatus, updating: true }
    }
    await startPanelComposeUpdater()
    applied.push('panel')
    return {
      status: 'updating',
      message: '面板更新已启动，服务将在约 30 秒内重启。请稍后刷新页面。',
      applied,
    }
  }

  await refreshPanelUpdateStatus()
  return {
    status: 'completed',
    message: applied.includes('dst')
      ? 'DST 运行镜像已更新，下次启动实例时将使用新环境。'
      : '更新完成',
    applied,
  }
}

export function isPanelUpdateInProgress(): boolean {
  return updating
}

async function resolveCheckIntervalMs(): Promise<number> {
  const settings = await getSystemPanelSettings()
  const hours = settings?.updateCheckIntervalHours
    ?? getDefaultPanelSettings().updateCheckIntervalHours
  const normalizedHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_CHECK_INTERVAL_HOURS
  return normalizedHours * 60 * 60 * 1000
}

async function scheduleNextCheck(app: FastifyInstance) {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
  }
  const intervalMs = await resolveCheckIntervalMs()
  schedulerTimer = setTimeout(async () => {
    try {
      const settings = await getSystemPanelSettings()
      const autoUpdate = settings?.autoUpdate ?? getDefaultPanelSettings().autoUpdate
      if (autoUpdate) {
        await refreshPanelUpdateStatus()
      }
    }
    catch (error) {
      app.log.warn({ error }, 'Hub 镜像定时检查失败')
    }
    finally {
      void scheduleNextCheck(app)
    }
  }, intervalMs)
}

export function schedulePanelUpdateChecks(app: FastifyInstance) {
  if (process.env.GSH_UNIT_TEST === '1') {
    return
  }
  if (schedulerStarted) {
    return
  }
  schedulerStarted = true

  setTimeout(async () => {
    try {
      const settings = await getSystemPanelSettings()
      const autoUpdate = settings?.autoUpdate ?? getDefaultPanelSettings().autoUpdate
      if (autoUpdate) {
        await refreshPanelUpdateStatus()
      }
    }
    catch (error) {
      app.log.warn({ error }, 'Hub 镜像首次检查失败')
    }
    finally {
      void scheduleNextCheck(app)
    }
  }, 30_000)
}
