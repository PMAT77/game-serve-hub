import Docker from 'dockerode'
import { resolveDockerConnectOptions } from './docker-connect'
import { getServerContainerConfig } from '../shared/config/container'

const DOCKER_PROBE_TIMEOUT_MS = 5_000
const DOCKER_STATUS_CACHE_MS = 30_000

interface TtlCacheEntry<T> {
  value: T
  expiresAt: number
}

const dockerStatusCache: { entry: TtlCacheEntry<'running' | 'stopped'> | null } = { entry: null }
let dockerRefreshInFlight: Promise<'running' | 'stopped'> | null = null

function createDockerClient() {
  const { dockerHost } = getServerContainerConfig()
  return new Docker(resolveDockerConnectOptions(dockerHost))
}

async function probeDockerStatusAsync(): Promise<'running' | 'stopped'> {
  const docker = createDockerClient()
  try {
    await Promise.race([
      docker.ping(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Docker ping timeout')), DOCKER_PROBE_TIMEOUT_MS)
      }),
    ])
    return 'running'
  }
  catch {
    return 'stopped'
  }
}

function writeDockerStatusCache(value: 'running' | 'stopped') {
  dockerStatusCache.entry = {
    value,
    expiresAt: Date.now() + DOCKER_STATUS_CACHE_MS,
  }
}

function scheduleDockerRefresh(force = false) {
  const now = Date.now()
  if (!force && dockerStatusCache.entry && dockerStatusCache.entry.expiresAt > now) {
    return
  }
  if (dockerRefreshInFlight) {
    return
  }
  dockerRefreshInFlight = probeDockerStatusAsync()
    .then((value) => {
      writeDockerStatusCache(value)
      return value
    })
    .finally(() => {
      dockerRefreshInFlight = null
    })
}

/** 等待探测完成；用于 SteamCMD / 实例等需要准确状态的路径 */
export async function resolveDockerStatus(force = false): Promise<'running' | 'stopped'> {
  const now = Date.now()
  if (!force && dockerStatusCache.entry && dockerStatusCache.entry.expiresAt > now) {
    return dockerStatusCache.entry.value
  }
  if (dockerRefreshInFlight) {
    return dockerRefreshInFlight
  }
  dockerRefreshInFlight = probeDockerStatusAsync()
    .then((value) => {
      writeDockerStatusCache(value)
      return value
    })
    .finally(() => {
      dockerRefreshInFlight = null
    })
  return dockerRefreshInFlight
}

export function getCachedDockerStatus() {
  scheduleDockerRefresh()
  return dockerStatusCache.entry?.value ?? 'stopped'
}

export function startDockerStatusRefreshLoop() {
  scheduleDockerRefresh(true)
  const dockerTimer = setInterval(() => scheduleDockerRefresh(true), DOCKER_STATUS_CACHE_MS)
  if (typeof dockerTimer === 'object' && 'unref' in dockerTimer && typeof dockerTimer.unref === 'function') {
    dockerTimer.unref()
  }
}
