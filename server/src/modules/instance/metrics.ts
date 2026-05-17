import process from 'node:process'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { DbGameInstance } from '../../shared/db/index'
import {
  findUserByToken,
  listGameInstances,
  updateGameInstanceRuntime,
} from '../../shared/db/index'
import { success, unauthorized } from '../../shared/http/response'
import {
  computeUptimeSeconds,
  processStartIsoFromElapsed,
  sampleProcessMetrics,
} from '../../shared/instance-runtime/process-metrics'

const LOCAL_NODE_ID = 'local-node'

export interface InstanceRuntimeMetrics {
  cpuUsageRate: number | null
  memoryMb: number | null
  uptimeSeconds: number | null
}

export interface InstanceMetricsResponse {
  items: Record<string, InstanceRuntimeMetrics | null>
  collectedAt: string
}

interface InstanceMetricsBody {
  ids?: string[]
}

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return tokenHeader ?? ''
}

async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  const token = normalizeToken(request.headers.token)
  if (!token) {
    return unauthorized(request)
  }
  const user = await findUserByToken(token)
  if (!user) {
    return unauthorized(request)
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as NodeJS.ErrnoException).code)
      : ''
    return code !== 'ESRCH'
  }
}

async function collectMetricsForInstance(instance: DbGameInstance): Promise<InstanceRuntimeMetrics | null> {
  if (instance.status !== 'running' || instance.nodeId !== LOCAL_NODE_ID) {
    return null
  }
  const pid = instance.runtimePid
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return null
  }
  if (!isPidAlive(pid)) {
    return null
  }

  let runtimeStartedAt = instance.runtimeStartedAt
  const sample = await sampleProcessMetrics(pid)
  if (!sample) {
    return null
  }

  if (!runtimeStartedAt) {
    runtimeStartedAt = processStartIsoFromElapsed(sample.elapsedSeconds)
    await updateGameInstanceRuntime(instance.id, {
      runtimeStartedAt,
    })
  }

  return {
    cpuUsageRate: sample.cpuUsageRate,
    memoryMb: sample.memoryMb,
    uptimeSeconds: computeUptimeSeconds(runtimeStartedAt, sample.elapsedSeconds),
  }
}

export async function handleInstanceMetrics(
  request: FastifyRequest,
  body: InstanceMetricsBody,
): Promise<ApiSuccessResponse<InstanceMetricsResponse> | ApiErrorResponse> {
  const authError = await verifyAuthorized(request)
  if (authError) {
    return authError
  }

  const idFilter = new Set(
    (body.ids ?? [])
      .map(id => id?.trim())
      .filter((id): id is string => Boolean(id)),
  )
  const hasIdFilter = idFilter.size > 0

  const instances = await listGameInstances({ status: 'running' })
  const targets = instances.filter((item) => {
    if (item.nodeId !== LOCAL_NODE_ID) {
      return false
    }
    if (hasIdFilter && !idFilter.has(item.id)) {
      return false
    }
    return true
  })

  const collectedAt = new Date().toISOString()
  const items: Record<string, InstanceRuntimeMetrics | null> = {}

  if (hasIdFilter) {
    for (const id of idFilter) {
      items[id] = null
    }
  }

  await Promise.all(targets.map(async (instance) => {
    items[instance.id] = await collectMetricsForInstance(instance)
  }))

  return success({ items, collectedAt }, request)
}

export function registerInstanceMetricsRoute(app: FastifyInstance) {
  app.post('/app/instance/metrics', async (request) => {
    return handleInstanceMetrics(request, (request.body ?? {}) as InstanceMetricsBody)
  })
}
