import fs from 'node:fs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  ClusterConfigDto,
  ClusterOnlinePlayersDto,
  ClusterSavePayload,
  ClusterSaveResult,
} from '../../../../shared/contracts/cluster'
import { findUserByToken, getGameInstanceById, updateGameInstanceRuntime } from '../../shared/db/index'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import {
  ensureClusterDirectory,
  getClusterConfig,
  resolveInstanceInstallPath,
  saveClusterConfig,
} from '../../infra/game-adapter/dst/cluster-service'
import { queryDstOnlinePlayerCount } from '../../infra/game-adapter/dst/online-players'
import { isInstanceContainerRunning } from '../instance/container-lifecycle'
import {
  ensureContainerRuntimeReady,
  stopInstanceContainer,
} from '../instance/container-lifecycle'
import { isInstallJobActive } from '../instance/install-service'
import { businessError, success, unauthorized } from '../../shared/http/response'

const LOCAL_NODE_ID = 'local-node'

interface ClusterQuery {
  instanceId?: string
}

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return tokenHeader ?? ''
}

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const token = normalizeToken(request.headers.token)
  return token || undefined
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

async function resolveDstInstance(instanceId: string, request: FastifyRequest) {
  if (!instanceId) {
    return { ok: false as const, error: businessError('实例 ID 不能为空', request) }
  }
  const instance = await getGameInstanceById(instanceId)
  if (!instance) {
    return { ok: false as const, error: businessError('实例不存在', request) }
  }
  if (instance.nodeId !== LOCAL_NODE_ID) {
    return { ok: false as const, error: businessError('当前仅支持本地节点实例房间配置', request) }
  }
  if (instance.gameCode !== DST_APP_ID) {
    return { ok: false as const, error: businessError('当前仅支持 DST 实例房间配置', request) }
  }
  const installPath = resolveInstanceInstallPath(instance)
  if (!fs.existsSync(installPath)) {
    return { ok: false as const, error: businessError('实例安装目录不存在，请先在实例管理中完成安装', request) }
  }
  try {
    ensureClusterDirectory(installPath)
  }
  catch {
    return { ok: false as const, error: businessError('无法创建房间配置目录', request) }
  }
  return {
    ok: true as const,
    instance: {
      ...instance,
      installPath,
    },
  }
}

async function restartInstance(app: FastifyInstance, request: FastifyRequest, instanceId: string): Promise<ApiErrorResponse | undefined> {
  const current = await getGameInstanceById(instanceId)
  if (!current) {
    return businessError('实例不存在', request)
  }
  if (current.status === 'pending_install' || current.status === 'installing' || isInstallJobActive(instanceId)) {
    return businessError('实例正在安装中，请稍后再试', request)
  }
  const runtimeReady = await ensureContainerRuntimeReady()
  if (!runtimeReady.ok) {
    return businessError(runtimeReady.message ?? '容器运行时未就绪', request)
  }
  if (current.status === 'running' || current.containerId) {
    try {
      await stopInstanceContainer(instanceId)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '重启时停止实例失败'
      await updateGameInstanceRuntime(instanceId, {
        status: 'error',
        lastError: message,
      })
      return businessError(message, request)
    }
  }
  const response = await app.inject({
    method: 'POST',
    url: '/app/instance/start',
    headers: {
      token: normalizeToken(request.headers.token),
    },
    payload: { id: instanceId },
  })
  if (response.statusCode >= 400) {
    return businessError('实例重启失败', request)
  }
  const payload = JSON.parse(response.body) as ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse
  if ('error' in payload && payload.error) {
    return businessError(payload.error, request)
  }
}

/**
 * cluster 模块：DST 房间（cluster.ini）结构化读写。
 */
export function registerClusterModule(app: FastifyInstance) {
  app.get('/app/instance/cluster', async (request): Promise<ApiSuccessResponse<ClusterConfigDto> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = request.query as ClusterQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveDstInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const data = getClusterConfig(resolved.instance)
      return success(data, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '读取房间配置失败'
      return businessError(message, request)
    }
  })

  app.get('/app/instance/cluster/online-players', async (request): Promise<ApiSuccessResponse<ClusterOnlinePlayersDto> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = request.query as ClusterQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveDstInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const config = getClusterConfig(resolved.instance)
      const running = await isInstanceContainerRunning(instanceId)
      const onlinePlayerCount = running
        ? await queryDstOnlinePlayerCount(instanceId)
        : null
      return success({
        instanceId,
        running,
        onlinePlayerCount,
        maxPlayers: config.maxPlayers,
      }, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '读取在线人数失败'
      return businessError(message, request)
    }
  })

  app.put('/app/instance/cluster', async (request): Promise<ApiSuccessResponse<ClusterSaveResult> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ClusterSavePayload
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveDstInstance(instanceId, request)
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const result = saveClusterConfig(resolved.instance, body)
      if (body.restart) {
        const restartError = await restartInstance(app, request, instanceId)
        if (restartError) {
          return restartError
        }
        result.restarted = true
      }
      return success(result, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '保存房间配置失败'
      return businessError(message, request)
    }
  })
}
