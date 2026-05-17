import pidusage from 'pidusage'

export interface ProcessMetricsSample {
  cpuUsageRate: number
  memoryMb: number
  /** Process elapsed time in seconds (from pidusage). */
  elapsedSeconds: number
}

const CACHE_TTL_MS = 2000
const cache = new Map<number, { data: ProcessMetricsSample, expiresAt: number }>()

function clampPercent(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0)
}

function toMemoryMb(bytes: number) {
  return Math.max(0, Math.round(bytes / 1024 / 1024))
}

/**
 * Sample CPU / RSS for a single process PID. Returns null if the process is gone or unreadable.
 */
export async function sampleProcessMetrics(pid: number): Promise<ProcessMetricsSample | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null
  }
  const now = Date.now()
  const cached = cache.get(pid)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }
  try {
    const raw = await pidusage(pid)
    const stats = (typeof raw === 'object' && raw !== null && 'cpu' in raw
      ? raw
      : null) as { cpu: number, memory: number, elapsed: number } | null
    if (!stats) {
      return null
    }
    const data: ProcessMetricsSample = {
      cpuUsageRate: Number(clampPercent(stats.cpu).toFixed(2)),
      memoryMb: toMemoryMb(stats.memory),
      elapsedSeconds: Math.max(0, Math.floor(stats.elapsed / 1000)),
    }
    cache.set(pid, { data, expiresAt: now + CACHE_TTL_MS })
    return data
  }
  catch {
    cache.delete(pid)
    return null
  }
}

/** Resolve process start time as ISO string from elapsed seconds. */
export function processStartIsoFromElapsed(elapsedSeconds: number): string {
  const startedMs = Date.now() - Math.max(0, elapsedSeconds) * 1000
  return new Date(startedMs).toISOString()
}

export function computeUptimeSeconds(runtimeStartedAt: string | null | undefined, elapsedSeconds?: number | null): number | null {
  if (runtimeStartedAt?.trim()) {
    const started = Date.parse(runtimeStartedAt)
    if (Number.isFinite(started)) {
      return Math.max(0, Math.floor((Date.now() - started) / 1000))
    }
  }
  if (typeof elapsedSeconds === 'number' && Number.isFinite(elapsedSeconds)) {
    return Math.max(0, Math.floor(elapsedSeconds))
  }
  return null
}
