import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { DbGameInstance } from '../../shared/db/index'
import { findUserByToken, getGameInstanceById } from '../../shared/db/index'
import { instanceRuntimeRegistry } from '../../shared/instance-runtime/registry'
import { businessError, success, unauthorized } from '../../shared/http/response'

const LOCAL_NODE_ID = 'local-node'

interface ConsoleLogsQuery {
  instanceId?: string
  afterId?: string
}

interface ConsoleInstanceBody {
  instanceId?: string
}

interface ConsoleCommandBody {
  instanceId?: string
  command?: string
}

interface ConsoleStreamQuery {
  instanceId?: string
  token?: string
}

function normalizeToken(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return value?.trim() ?? ''
}

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const headerToken = normalizeToken(request.headers.token)
  if (headerToken) {
    return headerToken
  }
  const query = request.query as { token?: string }
  return query.token?.trim() || undefined
}

async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  const token = getTokenByRequest(request)
  if (!token) {
    return unauthorized(request)
  }
  const user = await findUserByToken(token)
  if (!user) {
    return unauthorized(request)
  }
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

/**
 * console 模块：游戏实例运行时控制台（日志流 + 命令下发）。
 * 与「主机监控台」`/console/monitor` 区分，API 统一挂在 `/app/instance/console/*`。
 */
export function registerConsoleModule(app: FastifyInstance) {
  app.get('/app/instance/console/logs', async (request): Promise<ApiSuccessResponse<{
    lines: ReturnType<typeof instanceRuntimeRegistry.listLogs>
    running: boolean
  }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
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
    const process = instanceRuntimeRegistry.getProcess(instanceId)
    return success({
      lines: instanceRuntimeRegistry.listLogs(instanceId, Number.isNaN(afterId) ? 0 : afterId),
      running: Boolean(process && !process.killed),
    }, request)
  })

  app.post('/app/instance/console/logs/clear', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ConsoleInstanceBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    instanceRuntimeRegistry.clearLogs(instanceId)
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/console/command', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ConsoleCommandBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const command = body.command?.trim() ?? ''
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    if (resolved.instance.status !== 'running') {
      return businessError('实例未运行，无法发送控制台命令', request)
    }
    const result = instanceRuntimeRegistry.sendCommand(instanceId, command)
    if (!result.ok) {
      return businessError(result.message ?? '命令发送失败', request)
    }
    return success({ isSuccess: true }, request)
  })

  app.get('/app/instance/console/stream', async (request, reply) => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      reply.status(401).send(authError)
      return
    }
    const query = request.query as ConsoleStreamQuery
    const instanceId = normalizeInstanceId(query.instanceId)
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

    const process = instanceRuntimeRegistry.getProcess(instanceId)
    writeSse(reply, 'ready', {
      instanceId,
      running: Boolean(process && !process.killed),
    })
    for (const line of instanceRuntimeRegistry.listLogs(instanceId)) {
      writeSse(reply, 'log', line)
    }

    const unsubscribe = instanceRuntimeRegistry.subscribe(instanceId, (line) => {
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
}
