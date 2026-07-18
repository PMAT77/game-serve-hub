import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { InstanceConnectInfoDto, InstanceConsoleCommandShard } from '../../../../shared/contracts/console'
import type { ConsoleLogLine } from '../../shared/instance-runtime/console-log-store'
import type { DbGameInstance } from '../../shared/db/index'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import { getGameInstanceById } from '../../shared/db/index'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { buildDstConnectInfo } from '../../infra/game-adapter/dst/direct-connect'
import { resolveInstanceInstallPath } from '../../infra/game-adapter/dst/cluster-service'
import { instanceConsoleLogStore } from '../../shared/instance-runtime/console-log-store'
import {
  ensureContainerRuntimeReady,
  isCavesContainerRunning,
  isInstanceContainerRunning,
  sendInstanceContainerCommand,
} from '../instance/container-lifecycle'
import { isCavesShardConfigured, readClusterShardEnabledFromInstall } from '../../infra/game-adapter/dst/shard-service'
import { businessError, success } from '../../shared/http/response'
import { requirePermission, resolveAuthorizedContext } from '../system/auth'
import { consoleStreamTicketStore } from './stream-ticket'

const LOCAL_NODE_ID = 'local-node'

type ConsoleLogFilter = 'all' | 'game' | 'panel'

interface ConsoleLogsQuery {
  instanceId?: string
  afterId?: string
  stream?: string
}

interface ConnectInfoQuery {
  instanceId?: string
}

interface ConsoleInstanceBody {
  instanceId?: string
}

interface ConsoleCommandBody {
  instanceId?: string
  command?: string
  shard?: string
}

interface ConsoleStreamQuery {
  instanceId?: string
  streamTicket?: string
}

interface ConsoleStreamTicketBody {
  instanceId?: string
}

function normalizeInstanceId(value: string | undefined) {
  return value?.trim() ?? ''
}

type ResolveLocalInstanceResult =
  | { ok: false; error: ApiErrorResponse }
  | { ok: true; instance: DbGameInstance }

async function resolveLocalInstance(
  instanceId: string,
  request: FastifyRequest,
): Promise<ResolveLocalInstanceResult> {
  if (!instanceId) {
    return { ok: false, error: businessError('实例 ID 不能为空', request) }
  }
  const instance = await getGameInstanceById(instanceId)
  if (!instance) {
    return { ok: false, error: businessError('实例不存在', request) }
  }
  if (instance.nodeId !== LOCAL_NODE_ID) {
    return { ok: false, error: businessError('当前仅支持本地节点实例控制台', request) }
  }
  return { ok: true, instance }
}

function writeSse(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\n`)
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
}

function normalizeCommandShard(value: string | undefined): InstanceConsoleCommandShard | undefined {
  const raw = value?.trim().toLowerCase()
  if (!raw || raw === 'master') {
    return 'master'
  }
  if (raw === 'caves') {
    return 'caves'
  }
  return undefined
}

function normalizeLogFilter(value: string | undefined): ConsoleLogFilter {
  const raw = value?.trim().toLowerCase()
  if (raw === 'game' || raw === 'panel') {
    return raw
  }
  return 'all'
}

function filterConsoleLines(lines: ConsoleLogLine[], filter: ConsoleLogFilter): ConsoleLogLine[] {
  if (filter === 'all') {
    return lines
  }
  if (filter === 'game') {
    return lines.filter(line => line.stream === 'stdout' || line.stream === 'stderr')
  }
  return lines.filter(line => line.stream === 'system')
}

import { registerMaintenanceAnnounceRoutes } from './maintenance-routes'

/**
 * console 模块：游戏实例运行时控制台（日志流 + 命令下发）。
 * 与「主机监控台」`/console/monitor` 区分，API 统一挂在 `/app/instance/console/*`。
 */
export function registerConsoleModule(app: FastifyInstance) {
  app.get('/app/instance/connect-info', async (request): Promise<ApiSuccessResponse<InstanceConnectInfoDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = request.query as ConnectInfoQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    const instance = resolved.instance
    if (instance.gameCode.trim() !== DST_APP_ID) {
      return businessError('当前仅支持饥荒（343050）连接信息', request)
    }
    const installPath = resolveInstanceInstallPath(instance)
    const masterRunning = await isInstanceContainerRunning(instanceId)
    const shardEnabled = readClusterShardEnabledFromInstall(installPath)
    const cavesConfigured = shardEnabled && isCavesShardConfigured(installPath)
    const cavesRunning = cavesConfigured ? await isCavesContainerRunning(instanceId) : false
    const info = await buildDstConnectInfo(installPath, {
      gamePort: instance.gamePort,
      running: masterRunning,
    })
    return success({
      ...info,
      consoleShards: {
        masterRunning,
        cavesConfigured,
        cavesRunning,
      },
    }, request)
  })

  app.get('/app/instance/console/logs', async (request): Promise<ApiSuccessResponse<{
    lines: ReturnType<typeof instanceConsoleLogStore.listLogs>
    running: boolean
  }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = request.query as ConsoleLogsQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    const afterId = Number.parseInt(query.afterId ?? '0', 10)
    const logFilter = normalizeLogFilter(query.stream)
    const running = await isInstanceContainerRunning(instanceId)
    const lines = filterConsoleLines(
      instanceConsoleLogStore.listLogs(instanceId, Number.isNaN(afterId) ? 0 : afterId),
      logFilter,
    )
    return success({
      lines,
      running,
    }, request)
  })

  app.post('/app/instance/console/logs/clear', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ConsoleInstanceBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    instanceConsoleLogStore.clearLogs(instanceId)
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/console/command', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ConsoleCommandBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const command = body.command?.trim() ?? ''
    const shard = normalizeCommandShard(body.shard)
    if (!shard) {
      return businessError('分片参数无效，仅支持 master 或 caves', request)
    }
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    if (resolved.instance.status !== 'running') {
      return businessError('实例未运行，无法发送控制台命令', request)
    }
    const runtimeReady = await ensureContainerRuntimeReady()
    if (!runtimeReady.ok) {
      return businessError(runtimeReady.message ?? '容器运行时未就绪', request)
    }
    const result = await sendInstanceContainerCommand(instanceId, command, shard)
    if (!result.ok) {
      return businessError(result.message ?? '命令发送失败', request)
    }
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/console/stream-ticket', async (request): Promise<ApiSuccessResponse<{
    ticket: string
    expiresAt: string
  }> | ApiErrorResponse> => {
    const auth = await resolveAuthorizedContext(request, {
      permissions: NODE_INSTANCE_MANAGE_PERMISSION,
    })
    if (auth.error || !auth.context) {
      return auth.error ?? businessError('Unable to issue console stream authorization', request)
    }
    const body = (request.body ?? {}) as ConsoleStreamTicketBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    const issued = consoleStreamTicketStore.issue({
      instanceId,
      userId: auth.context.user.id,
    })
    return success({
      ticket: issued.ticket,
      expiresAt: new Date(issued.expiresAt).toISOString(),
    }, request)
  })

  app.get('/app/instance/console/stream', async (request, reply) => {
    const query = request.query as ConsoleStreamQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const streamTicket = query.streamTicket?.trim() ?? ''
    if (!streamTicket || !consoleStreamTicketStore.consume(streamTicket, instanceId)) {
      reply.status(401).send(businessError('Console stream authorization expired or is invalid', request))
      return
    }
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      reply.status(400).send(resolved.error)
      return
    }

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })

    const running = await isInstanceContainerRunning(instanceId)
    writeSse(reply, 'ready', {
      instanceId,
      running,
    })
    for (const line of instanceConsoleLogStore.listLogs(instanceId)) {
      writeSse(reply, 'log', line)
    }

    const unsubscribe = instanceConsoleLogStore.subscribe(instanceId, (line) => {
      writeSse(reply, 'log', line)
    })

    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 15000)

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      reply.raw.end()
    })
  })

  registerMaintenanceAnnounceRoutes(app)
}
