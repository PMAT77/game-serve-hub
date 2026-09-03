import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { pullGameDstImage } from '../../infra/container'
import {
  normalizeDigest,
  parseImageRef,
  shortDigest,
} from '../../infra/container/image-ref'
import { fetchRemoteImageDigest } from '../../infra/container/registry-manifest'
import { createDockerClient } from '../../infra/docker-connect'
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
  runtimeMode: 'docker' | 'native'
  panel: HubImageUpdateInfo
  dst: HubImageUpdateInfo
  release: GitHubReleaseSummary | null
  lastCheckedAt: string | null
  checking: boolean
  updating: boolean
  /** 至少有一种镜像支持一键更新（面板或 DST） */
  applySupported: boolean
  panelApplySupported: boolean
  dstApplySupported: boolean
  applyHint: string | null
  manualUpdateCommand: string | null
  checkError: string | null
}

export const STACK_CONTAINER_MOUNT = '/stack'

export interface StackPaths {
  /** 宿主机路径，用于 Docker bind 挂载与手动更新命令 */
  hostDir: string
  /** 面板进程内可访问的路径（容器内通常为 /stack） */
  localDir: string
}

export interface ApplySupport {
  panelSupported: boolean
  dstSupported: boolean
  supported: boolean
  hint: string | null
  stackPaths: StackPaths | null
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
  return createDockerClient()
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

export function hasStackRequiredFiles(baseDir: string, composeFiles: string[]): boolean {
  const envPath = path.join(baseDir, 'panel.env')
  if (!fs.existsSync(envPath)) {
    return false
  }
  return composeFiles.every(file => fs.existsSync(path.join(baseDir, file)))
}

export function resolveStackPaths(
  stackDir: string,
  composeFiles: string[],
  mountPath = STACK_CONTAINER_MOUNT,
): StackPaths | null {
  const hostDir = stackDir.trim()
  if (!hostDir || !path.isAbsolute(hostDir)) {
    return null
  }
  if (hasStackRequiredFiles(hostDir, composeFiles)) {
    return { hostDir, localDir: hostDir }
  }
  if (hasStackRequiredFiles(mountPath, composeFiles)) {
    return { hostDir, localDir: mountPath }
  }
  return null
}

function normalizeReleaseTag(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim() ?? ''
  return /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : fallback
}

export function isReleaseNewer(current: string | null, latest: string | null): boolean {
  const parse = (value: string | null) => {
    const match = value?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
    if (!match) {
      return null
    }
    return {
      parts: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] ?? null,
    }
  }
  const left = parse(current)
  const right = parse(latest)
  if (!left || !right) {
    return Boolean(latest && current && latest !== current)
  }
  for (let index = 0; index < left.parts.length; index += 1) {
    if (right.parts[index] !== left.parts[index]) {
      return right.parts[index] > left.parts[index]
    }
  }
  if (left.prerelease && !right.prerelease) {
    return true
  }
  if (!left.prerelease || !right.prerelease) {
    return false
  }
  return right.prerelease.localeCompare(left.prerelease, 'en', { numeric: true }) > 0
}

function buildManualUpdateCommand(stackPaths: StackPaths | null, releaseTag?: string | null): string {
  const config = loadServerConfig()
  if (config.runtimeMode === 'native') {
    const currentTag = normalizeReleaseTag(config.releaseVersion, 'v0.1.4')
    const targetTag = normalizeReleaseTag(releaseTag, currentTag)
    return `curl -fsSL https://raw.githubusercontent.com/${config.githubRepo}/${targetTag}/scripts/install.linux.sh | sudo env GSH_RELEASE_TAG=${targetTag} bash -s -- --mode native`
  }
  const hostDir = stackPaths?.hostDir || config.stackDir || '/opt/game-server-hub'
  const composeArgs = config.composeFiles.map(file => `-f ${file}`).join(' ')
  return [
    `cd ${hostDir}`,
    `docker compose --env-file panel.env ${composeArgs} pull`,
    `docker pull ${config.gameDstImage}`,
    `docker compose --env-file panel.env ${composeArgs} up -d`,
  ].join(' && ')
}

export function resolveApplySupport(config = loadServerConfig()): ApplySupport {
  if (config.runtimeMode === 'native') {
    return {
      panelSupported: false,
      dstSupported: false,
      supported: false,
      hint: '裸机模式使用带 SHA256 校验和回滚的安装脚本原地升级；请执行下方命令。',
      stackPaths: null,
    }
  }
  if (!config.stackDir) {
    return {
      panelSupported: false,
      dstSupported: true,
      supported: true,
      hint: '未配置 GSH_STACK_DIR，无法一键更新面板。请在 panel.env 中设置后重启面板，或使用下方手动命令。',
      stackPaths: null,
    }
  }
  if (!path.isAbsolute(config.stackDir)) {
    return {
      panelSupported: false,
      dstSupported: true,
      supported: true,
      hint: 'GSH_STACK_DIR 必须是绝对路径。',
      stackPaths: null,
    }
  }
  const stackPaths = resolveStackPaths(config.stackDir, config.composeFiles)
  if (!stackPaths) {
    return {
      panelSupported: false,
      dstSupported: true,
      supported: true,
      hint: '面板无法在容器内访问 compose 目录，无法一键更新面板。请使用下方手动命令。',
      stackPaths: null,
    }
  }
  return {
    panelSupported: true,
    dstSupported: true,
    supported: true,
    hint: null,
    stackPaths,
  }
}

function buildApplyFields(applySupport: ApplySupport, releaseTag?: string | null) {
  return {
    applySupported: applySupport.supported,
    panelApplySupported: applySupport.panelSupported,
    dstApplySupported: applySupport.dstSupported,
    applyHint: applySupport.hint,
    manualUpdateCommand: buildManualUpdateCommand(applySupport.stackPaths, releaseTag),
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
  const applySupport = resolveApplySupport(config)
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
    runtimeMode: config.runtimeMode,
    panel: emptyImage(config.panelImage),
    dst: emptyImage(config.gameDstImage),
    release: null,
    lastCheckedAt: null,
    checking: false,
    updating,
    ...buildApplyFields(applySupport),
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
    const applySupport = resolveApplySupport(config)
    const envReleaseVersion = resolveReleaseVersionFromEnv()
    if (config.runtimeMode === 'native') {
      const release = await fetchLatestGitHubRelease(config.githubRepo)
      const currentVersion = envReleaseVersion || null
      const latestVersion = release?.tagName ?? null
      const panel: HubImageUpdateInfo = {
        image: 'native-release',
        tag: currentVersion || 'unknown',
        releaseVersion: currentVersion,
        localDigest: config.buildSha || null,
        localDigestShort: config.buildSha ? config.buildSha.slice(0, 12) : null,
        remoteDigest: null,
        remoteDigestShort: null,
        updateAvailable: isReleaseNewer(currentVersion, latestVersion),
        localPresent: true,
        checkError: release ? null : '无法读取最新 GitHub Release',
      }
      const dst: HubImageUpdateInfo = {
        image: 'native-systemd',
        tag: 'host',
        releaseVersion: currentVersion,
        localDigest: null,
        localDigestShort: null,
        remoteDigest: null,
        remoteDigestShort: null,
        updateAvailable: false,
        localPresent: true,
        checkError: null,
      }
      const nextStatus: PanelUpdateStatus = {
        runtimeMode: config.runtimeMode,
        panel,
        dst,
        release,
        lastCheckedAt: new Date().toISOString(),
        checking: false,
        updating,
        ...buildApplyFields(applySupport, latestVersion),
        checkError: panel.checkError,
      }
      cachedStatus = nextStatus
      return nextStatus
    }
    const [panel, dst, release] = await Promise.all([
      buildImageUpdateInfo(config.panelImage, envReleaseVersion),
      buildImageUpdateInfo(config.gameDstImage, envReleaseVersion),
      fetchLatestGitHubRelease(config.githubRepo),
    ])

    const checkErrors = normalizeErrorMessages([panel.checkError, dst.checkError])
    const nextStatus: PanelUpdateStatus = {
      runtimeMode: config.runtimeMode,
      panel,
      dst,
      release,
      lastCheckedAt: new Date().toISOString(),
      checking: false,
      updating,
      ...buildApplyFields(applySupport, release?.tagName),
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
  const applySupport = resolveApplySupport(config)
  if (!applySupport.panelSupported || !applySupport.stackPaths) {
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
        `${applySupport.stackPaths.hostDir}:/stack:ro`,
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
  const applySupport = resolveApplySupport()
  const requested = targets?.length
    ? targets
    : (['panel', 'dst'] as Array<'panel' | 'dst'>).filter((target) => {
      if (target === 'panel') {
        return status.panel.updateAvailable && applySupport.panelSupported
      }
      return status.dst.updateAvailable && applySupport.dstSupported
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
