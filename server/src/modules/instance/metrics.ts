import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { DbGameInstance } from '../../shared/db/index'
import {
  findUserByToken,
  listGameInstances,
} from '../../shared/db/index'
import { getContainerRuntime } from '../../infra/container'
import { success, unauthorized } from '../../shared/http/response'
import { isInstanceContainerRunning, resolveInstanceContainerRef } from './container-lifecycle'

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

function computeUptimeSeconds(startedAt: string | null | undefined): number | null {
  if (!startedAt) {
    return null
  }
  const startedMs = Date.parse(startedAt)
  if (Number.isNaN(startedMs)) {
    return null
  }
  return Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
}

async function collectMetricsForInstance(instance: DbGameInstance): Promise<InstanceRuntimeMetrics | null> {
  if (instance.status !== 'running' || instance.nodeId !== LOCAL_NODE_ID) {
    return null
  }
  if (!await isInstanceContainerRunning(instance.id)) {
    return null
  }
  const ref = await resolveInstanceContainerRef(instance.id)
  if (!ref) {
    return null
  }
  try {
    const runtime = getContainerRuntime()
    const stats = await runtime.stats(ref)
    return {
      cpuUsageRate: stats.cpuUsageRate,
      memoryMb: stats.memoryMb,
      uptimeSeconds: computeUptimeSeconds(instance.runtimeStartedAt),
    }
  }
  catch {
    return {
      cpuUsageRate: null,
      memoryMb: null,
      uptimeSeconds: computeUptimeSeconds(instance.runtimeStartedAt),
    }
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
