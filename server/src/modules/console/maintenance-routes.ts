import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  InstanceMaintenanceAnnounceStateDto,
  InstanceMaintenancePushResultDto,
} from '../../../../shared/contracts/maintenance'
import {
  findUserByToken,
  getGameInstanceById,
  getMaintenanceDraft,
  insertMaintenancePushLog,
  listMaintenancePushLogs,
  upsertMaintenanceDraft,
} from '../../shared/db/index'
import {
  ensureContainerRuntimeReady,
  isInstanceContainerRunning,
  sendInstanceContainerCommand,
} from '../instance/container-lifecycle'
import { businessError, success, unauthorized } from '../../shared/http/response'
import {
  buildMaintenanceAnnounceCommand,
  normalizeMaintenanceMessage,
  validateMaintenanceMessage,
} from './maintenance-announce'
import { toMaintenanceAnnounceStateDto, toMaintenancePushLogDto } from './maintenance-mapper'

const LOCAL_NODE_ID = 'local-node'

interface MaintenanceInstanceQuery {
  instanceId?: string
}

interface MaintenanceDraftBody {
  instanceId?: string
  message?: string
}

interface MaintenancePushBody {
  instanceId?: string
  message?: string
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

async function verifyAuthorizedUser(request: FastifyRequest) {
  const token = getTokenByRequest(request)
  if (!token) {
    return { error: unauthorized(request) as ApiErrorResponse }
  }
  const user = await findUserByToken(token)
  if (!user) {
    return { error: unauthorized(request) as ApiErrorResponse }
  }
  return { user }
}

function normalizeInstanceId(value: string | undefined) {
  return value?.trim() ?? ''
}

async function resolveLocalInstance(instanceId: string, request: FastifyRequest) {
  if (!instanceId) {
    return { ok: false as const, error: businessError('实例 ID 不能为空', request) }
  }
  const instance = await getGameInstanceById(instanceId)
  if (!instance) {
    return { ok: false as const, error: businessError('实例不存在', request) }
  }
  if (instance.nodeId !== LOCAL_NODE_ID) {
    return { ok: false as const, error: businessError('当前仅支持本地节点实例维护公告', request) }
  }
  return { ok: true as const, instance }
}

export function registerMaintenanceAnnounceRoutes(app: FastifyInstance) {
  app.get('/app/instance/maintenance/announce', async (request): Promise<ApiSuccessResponse<InstanceMaintenanceAnnounceStateDto> | ApiErrorResponse> => {
    const auth = await verifyAuthorizedUser(request)
    if (auth.error) {
      return auth.error
    }
    const query = request.query as MaintenanceInstanceQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    const draft = await getMaintenanceDraft(instanceId)
    const recentPushes = await listMaintenancePushLogs(instanceId)
    return success(toMaintenanceAnnounceStateDto(draft, recentPushes), request)
  })

  app.put('/app/instance/maintenance/announce', async (request): Promise<ApiSuccessResponse<InstanceMaintenanceAnnounceStateDto> | ApiErrorResponse> => {
    const auth = await verifyAuthorizedUser(request)
    if (auth.error) {
      return auth.error
    }
    const body = (request.body ?? {}) as MaintenanceDraftBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const message = normalizeMaintenanceMessage(body.message)
    const validationError = validateMaintenanceMessage(message)
    if (validationError) {
      return businessError(validationError, request)
    }
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    const draft = await upsertMaintenanceDraft(instanceId, message)
    const recentPushes = await listMaintenancePushLogs(instanceId)
    return success(toMaintenanceAnnounceStateDto(draft, recentPushes), request)
  })

  app.post('/app/instance/maintenance/announce/push', async (request): Promise<ApiSuccessResponse<InstanceMaintenancePushResultDto> | ApiErrorResponse> => {
    const auth = await verifyAuthorizedUser(request)
    if (auth.error || !auth.user) {
      return auth.error!
    }
    const body = (request.body ?? {}) as MaintenancePushBody
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveLocalInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    const instance = resolved.instance
    if (instance.status !== 'running') {
      return businessError('实例未运行，无法推送维护公告', request)
    }
    const masterRunning = await isInstanceContainerRunning(instanceId)
    if (!masterRunning) {
      return businessError('主世界未运行，无法推送维护公告', request)
    }

    const bodyMessage = normalizeMaintenanceMessage(body.message)
    const draft = await getMaintenanceDraft(instanceId)
    const message = bodyMessage || draft?.message?.trim() || ''
    const validationError = validateMaintenanceMessage(message)
    if (validationError) {
      return businessError(validationError, request)
    }

    const runtimeReady = await ensureContainerRuntimeReady()
    if (!runtimeReady.ok) {
      return businessError(runtimeReady.message ?? '容器运行时未就绪', request)
    }

    let command: string
    try {
      command = buildMaintenanceAnnounceCommand(message)
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : '公告内容无效'
      return businessError(msg, request)
    }

    const result = await sendInstanceContainerCommand(instanceId, command, 'master')
    const pushLog = await insertMaintenancePushLog({
      instanceId,
      message,
      operatorAccount: auth.user.account,
      status: result.ok ? 'success' : 'failed',
      errorMessage: result.ok ? null : (result.message ?? '推送失败'),
    })

    if (bodyMessage) {
      await upsertMaintenanceDraft(instanceId, message)
    }

    return success({
      isSuccess: result.ok,
      pushLog: toMaintenancePushLogDto(pushLog),
      ...(result.ok ? {} : { errorMessage: result.message ?? '推送失败' }),
    }, request)
  })
}
