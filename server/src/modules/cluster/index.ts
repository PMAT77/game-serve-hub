import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  ClusterConfigDto,
  ClusterOnlinePlayersDto,
  ClusterSavePayload,
  ClusterSaveResult,
} from '../../../../shared/contracts/cluster'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import { resolveLocalDstInstance } from '../../shared/dst/local-dst-instance'
import {
  getClusterConfig,
  saveClusterConfig,
} from '../../infra/game-adapter/dst/cluster-service'
import { queryDstOnlinePlayerCount } from '../../infra/game-adapter/dst/online-players'
import { isInstanceContainerRunning } from '../instance/container-lifecycle'
import { injectRestartInstance } from '../instance/inject-restart'
import { businessError, success } from '../../shared/http/response'
import { requirePermission } from '../system/auth'

interface ClusterQuery {
  instanceId?: string
}

function normalizeInstanceId(value: string | undefined) {
  return value?.trim() ?? ''
}

async function restartInstance(
  app: FastifyInstance,
  request: FastifyRequest,
  instanceId: string,
  options?: { autoAllocatePorts?: boolean },
): Promise<ApiErrorResponse | undefined> {
  return injectRestartInstance(app, request, instanceId, options)
}

const CLUSTER_RESOLVE_MESSAGES = {
  wrongNode: '当前仅支持本地节点实例房间配置',
  wrongGame: '当前仅支持 DST 实例房间配置',
  missingInstallPath: '实例安装目录不存在，请先在实例管理中完成安装',
  clusterDirFailed: '无法创建房间配置目录',
}

/**
 * cluster 模块：DST 房间（cluster.ini）结构化读写。
 */
export function registerClusterModule(app: FastifyInstance) {
  app.get('/app/instance/cluster', async (request): Promise<ApiSuccessResponse<ClusterConfigDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = request.query as ClusterQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: CLUSTER_RESOLVE_MESSAGES })
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
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = request.query as ClusterQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: CLUSTER_RESOLVE_MESSAGES })
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
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ClusterSavePayload
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: CLUSTER_RESOLVE_MESSAGES })
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
