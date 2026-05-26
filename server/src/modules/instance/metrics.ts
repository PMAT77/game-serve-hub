import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import type { DbGameInstance } from '../../shared/db/index'
import {
  listGameInstances,
} from '../../shared/db/index'
import { getContainerRuntime } from '../../infra/container'
import { businessError, success } from '../../shared/http/response'
import { ensureContainerRuntimeReady, isInstanceContainerRunning, resolveInstanceContainerRef } from './container-lifecycle'
import { requirePermission } from '../system/auth'

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
  const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
  if (authError) {
    return authError
  }

  const runtimeReady = await ensureContainerRuntimeReady()
  if (!runtimeReady.ok) {
    return businessError(runtimeReady.message ?? '容器运行时未就绪', request)
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
