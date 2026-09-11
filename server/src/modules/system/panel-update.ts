import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { pullGameDstImage } from '../../infra/container'
import {
  normalizeDigest,
  parseImageRef,
  shortDigest,
} from '../../infra/container/image-ref'
import { fetchRemoteImageIdentity } from '../../infra/container/registry-manifest'
import { createDockerClient } from '../../infra/docker-connect'
import { loadServerConfig } from '../../shared/config'
import { getSystemPanelSettings } from '../../shared/db/index'
import { getDefaultPanelSettings } from './defaults'

/** 更新语义分类，用于把"同版本号但镜像变了"与"版本更高"区分展示 */
export type UpdateKind = 'none' | 'newer' | 'same-version-changed' | 'unknown'

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
  /** v0.2.0 起统一镜像：面板/DST/SteamCMD 共用同一镜像，单一更新目标 */
  image: HubImageUpdateInfo
  release: GitHubReleaseSummary | null
  lastCheckedAt: string | null
  checking: boolean
  updating: boolean
  /** 统一镜像是否支持一键更新（docker 模式且 stack 可达时为真） */
  applySupported: boolean
  imageApplySupported: boolean
  applyHint: string | null
  /** 更新语义分类：区分"版本更高"与"同版本号但镜像内容变了" */
  updateKind: UpdateKind
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
  imageSupported: boolean
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

/**
 * 收集本地镜像持有的全部身份凭据。
 * RepoDigests 来自 docker pull（多架构镜像下是 manifest list 摘要）；
 * Id 是镜像 config 摘要；RootFS.Layers 是未压缩层摘要 ——
 * docker load 导入的离线包连 config 摘要都与 registry 不同，只有层能对上。
 */
async function inspectLocalImageDigest(image: string): Promise<{
  digests: string[]
  layers: string[]
  present: boolean
  releaseVersion: string | null
}> {
  try {
    const info = await resolveDocker().getImage(image).inspect() as {
      Id?: string
      RepoDigests?: string[]
      RootFS?: { Layers?: string[] }
      Config?: { Labels?: Record<string, string> }
    }
    const digests = [...new Set(
      [...(info.RepoDigests ?? []), info.Id]
        .map(item => normalizeDigest(item))
        .filter((digest): digest is string => Boolean(digest)),
    )]
    const layers = (info.RootFS?.Layers ?? [])
      .map(layer => normalizeDigest(layer))
      .filter((layer): layer is string => Boolean(layer))
    const labelVersion = info.Config?.Labels?.['org.opencontainers.image.version']
    return {
      digests,
      layers,
      present: true,
      releaseVersion: labelVersion?.trim() || null,
    }
  }
  catch {
    return {
      digests: [],
      layers: [],
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

function parseVersionTriple(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return null
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
}

/**
 * 把"有新版本"细分为用户能理解的几种情形。
 * Docker 模式的 updateAvailable 只由镜像摘要决定，与版本号无关，
 * 因此必须把"版本号相同但镜像变了"单独区分，否则界面自相矛盾。
 */
export function resolveUpdateKind(input: {
  runtimeMode: 'docker' | 'native'
  updateAvailable: boolean
  currentVersion: string | null
  latestVersion: string | null
}): UpdateKind {
  if (!input.updateAvailable) {
    return 'none'
  }
  if (input.runtimeMode === 'native') {
    return 'newer'
  }
  if (!input.latestVersion) {
    return 'unknown'
  }
  const current = parseVersionTriple(input.currentVersion)
  const latest = parseVersionTriple(input.latestVersion)
  if (current && latest && current === latest) {
    return 'same-version-changed'
  }
  if (isReleaseNewer(input.currentVersion, input.latestVersion)) {
    return 'newer'
  }
  return 'unknown'
}

function buildManualUpdateCommand(stackPaths: StackPaths | null, releaseTag?: string | null): string {
  const config = loadServerConfig()
  if (config.runtimeMode === 'native') {
    const currentTag = normalizeReleaseTag(config.releaseVersion, 'v0.3.1')
    const targetTag = normalizeReleaseTag(releaseTag, currentTag)
    return `curl -fsSL https://raw.githubusercontent.com/${config.githubRepo}/${targetTag}/scripts/install.linux.sh | sudo env GSH_RELEASE_TAG=${targetTag} bash -s -- --mode native`
  }
  const hostDir = stackPaths?.hostDir || config.stackDir || '/opt/game-server-hub'
  const composeArgs = config.composeFiles.map(file => `-f ${file}`).join(' ')
  return [
    `cd ${hostDir}`,
    `docker compose --env-file panel.env ${composeArgs} pull && docker compose --env-file panel.env ${composeArgs} up -d`,
  ].join(' && ')
}

export function resolveApplySupport(config = loadServerConfig()): ApplySupport {
  if (config.runtimeMode === 'native') {
    return {
      imageSupported: false,
      supported: false,
      hint: '当前部署方式需通过安装脚本更新面板，请执行下方命令。',
      stackPaths: null,
    }
  }
  if (!config.stackDir) {
    return {
      imageSupported: false,
      supported: true,
      hint: '未配置 GSH_STACK_DIR，无法一键更新面板。请在 panel.env 中设置后重启面板，或使用下方手动命令。',
      stackPaths: null,
    }
  }
  if (!path.isAbsolute(config.stackDir)) {
    return {
      imageSupported: false,
      supported: true,
      hint: 'GSH_STACK_DIR 必须是绝对路径。',
      stackPaths: null,
    }
  }
  const stackPaths = resolveStackPaths(config.stackDir, config.composeFiles)
  if (!stackPaths) {
    return {
      imageSupported: false,
      supported: true,
      hint: '面板无法在容器内访问 compose 目录，无法一键更新面板。请使用下方手动命令。',
      stackPaths: null,
    }
  }
  return {
    imageSupported: true,
    supported: true,
    hint: null,
    stackPaths,
  }
}

function buildApplyFields(applySupport: ApplySupport, releaseTag?: string | null) {
  return {
    applySupported: applySupport.supported,
    imageApplySupported: applySupport.imageSupported,
    applyHint: applySupport.hint,
    manualUpdateCommand: buildManualUpdateCommand(applySupport.stackPaths, releaseTag),
  }
}

/** 镜像身份：摘要集合 + 未压缩层指纹 */
export interface ImageIdentity {
  digests: string[]
  layers: string[]
}

function hasSameLayers(left: string[], right: string[]): boolean {
  return left.length > 0
    && left.length === right.length
    && left.every((layer, index) => layer === right[index])
}

/**
 * 本地镜像是否落后于远端。
 * Docker 部署下更新只按镜像内容判断，而同一份内容可以有多种凭据：manifest list、
 * 平台清单、config、未压缩层摘要 —— 本地与远端各持其中一部分（`docker pull` 记录
 * manifest list 摘要，`docker load` 导入的离线包连 config 摘要都与 registry 不同）。
 * 所以先比摘要集合，再退回比层指纹：只要有一种凭据对上，就是同一个镜像。
 */
export function isImageOutdated(input: {
  local: ImageIdentity
  remote: ImageIdentity
}): boolean {
  if (input.remote.digests.length === 0 && input.remote.layers.length === 0) {
    return false
  }
  if (input.local.digests.length === 0 && input.local.layers.length === 0) {
    return true
  }
  if (input.local.digests.some(digest => input.remote.digests.includes(digest))) {
    return false
  }
  return !hasSameLayers(input.local.layers, input.remote.layers)
}

async function buildImageUpdateInfo(
  image: string,
  fallbackReleaseVersion: string | null,
): Promise<HubImageUpdateInfo> {
  const parsed = parseImageRef(image)
  let localDigests: string[] = []
  let localLayers: string[] = []
  let remoteDigests: string[] = []
  let remoteLayers: string[] = []
  let remotePrimary: string | null = null
  let localPresent = false
  let releaseVersion = fallbackReleaseVersion
  let checkError: string | null = null

  try {
    const local = await inspectLocalImageDigest(image)
    localDigests = local.digests
    localLayers = local.layers
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
    const remote = await fetchRemoteImageIdentity(image)
    remotePrimary = remote.primary
    remoteLayers = remote.layers
    remoteDigests = [...new Set(
      [remote.primary, ...remote.aliases]
        .filter((digest): digest is string => Boolean(digest)),
    )]
  }
  catch (error) {
    checkError = normalizeErrorMessages([
      checkError,
      error instanceof Error ? error.message : String(error),
    ])
  }

  const localDigest = localDigests[0] ?? null

  return {
    image,
    tag: parsed.tag,
    releaseVersion,
    localDigest,
    localDigestShort: shortDigest(localDigest),
    remoteDigest: remotePrimary,
    remoteDigestShort: shortDigest(remotePrimary),
    updateAvailable: isImageOutdated({
      local: { digests: localDigests, layers: localLayers },
      remote: { digests: remoteDigests, layers: remoteLayers },
    }),
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
    image: emptyImage(config.panelImage),
    release: null,
    lastCheckedAt: null,
    checking: false,
    updating,
    ...buildApplyFields(applySupport),
    updateKind: 'none',
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
      const nativeUpdateAvailable = isReleaseNewer(currentVersion, latestVersion)
      const image: HubImageUpdateInfo = {
        image: 'native-release',
        tag: currentVersion || 'unknown',
        releaseVersion: currentVersion,
        localDigest: config.buildSha || null,
        localDigestShort: config.buildSha ? config.buildSha.slice(0, 12) : null,
        remoteDigest: null,
        remoteDigestShort: null,
        updateAvailable: nativeUpdateAvailable,
        localPresent: true,
        checkError: release ? null : '无法读取最新 GitHub Release',
      }
      const nextStatus: PanelUpdateStatus = {
        runtimeMode: config.runtimeMode,
        image,
        release,
        lastCheckedAt: new Date().toISOString(),
        checking: false,
        updating,
        ...buildApplyFields(applySupport, latestVersion),
        updateKind: resolveUpdateKind({
          runtimeMode: 'native',
          updateAvailable: nativeUpdateAvailable,
          currentVersion,
          latestVersion,
        }),
        checkError: image.checkError,
      }
      cachedStatus = nextStatus
      return nextStatus
    }
    const [image, release] = await Promise.all([
      buildImageUpdateInfo(config.panelImage, envReleaseVersion),
      fetchLatestGitHubRelease(config.githubRepo),
    ])

    const nextStatus: PanelUpdateStatus = {
      runtimeMode: config.runtimeMode,
      image,
      release,
      lastCheckedAt: new Date().toISOString(),
      checking: false,
      updating,
      ...buildApplyFields(applySupport, release?.tagName),
      updateKind: resolveUpdateKind({
        runtimeMode: 'docker',
        updateAvailable: image.updateAvailable,
        currentVersion: image.releaseVersion,
        latestVersion: release?.tagName ?? null,
      }),
      checkError: image.checkError,
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
  if (!applySupport.imageSupported || !applySupport.stackPaths) {
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

export async function applyPanelUpdate(): Promise<{ status: 'updating' | 'completed', message: string }> {
  if (updating) {
    throw new Error('更新正在进行中，请稍后再试')
  }

  const status = cachedStatus ?? await refreshPanelUpdateStatus()
  if (!status.image.updateAvailable) {
    return {
      status: 'completed',
      message: '当前已是最新版本',
    }
  }

  const applySupport = resolveApplySupport()
  updating = true
  if (cachedStatus) {
    cachedStatus = { ...cachedStatus, updating: true }
  }

  // 统一镜像：预拉取即同时完成 DST/SteamCMD 运行环境更新
  const pullResult = await pullGameDstImage({ force: true })
  if (!pullResult.ok) {
    updating = false
    if (cachedStatus) {
      cachedStatus = { ...cachedStatus, updating: false }
    }
    throw new Error(pullResult.error)
  }

  if (!applySupport.imageSupported || !applySupport.stackPaths) {
    updating = false
    if (cachedStatus) {
      cachedStatus = { ...cachedStatus, updating: false }
    }
    await refreshPanelUpdateStatus()
    return {
      status: 'completed',
      message: '统一镜像已拉取到本地，重启面板容器后生效。请使用下方手动命令或 gsh update。',
    }
  }

  await startPanelComposeUpdater()
  return {
    status: 'updating',
    message: '面板更新已启动，服务将在约 30 秒内重启。请稍后刷新页面。',
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
