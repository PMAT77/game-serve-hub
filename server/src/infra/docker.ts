import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const DOCKER_PROBE_TIMEOUT_MS = 800
const DOCKER_STATUS_CACHE_MS = 30_000

const execFileAsync = promisify(execFile)

interface TtlCacheEntry<T> {
  value: T
  expiresAt: number
}

const dockerStatusCache: { entry: TtlCacheEntry<'running' | 'stopped'> | null } = { entry: null }
let dockerRefreshInFlight = false

async function probeDockerStatusAsync(): Promise<'running' | 'stopped'> {
  try {
    await execFileAsync('docker', ['info'], {
      timeout: DOCKER_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return 'running'
  }
  catch {
    return 'stopped'
  }
}

function scheduleDockerRefresh(force = false) {
  const now = Date.now()
  if (dockerRefreshInFlight) {
    return
  }
  if (!force && dockerStatusCache.entry && dockerStatusCache.entry.expiresAt > now) {
    return
  }
  dockerRefreshInFlight = true
  void probeDockerStatusAsync()
    .then((value) => {
      dockerStatusCache.entry = {
        value,
        expiresAt: Date.now() + DOCKER_STATUS_CACHE_MS,
      }
    })
    .finally(() => {
      dockerRefreshInFlight = false
    })
}

export function getCachedDockerStatus() {
  scheduleDockerRefresh()
  return dockerStatusCache.entry?.value ?? 'stopped'
}

export function startDockerStatusRefreshLoop() {
  scheduleDockerRefresh(true)
  const dockerTimer = setInterval(scheduleDockerRefresh, DOCKER_STATUS_CACHE_MS, true)
  if (typeof dockerTimer === 'object' && 'unref' in dockerTimer && typeof dockerTimer.unref === 'function') {
    dockerTimer.unref()
  }
}
