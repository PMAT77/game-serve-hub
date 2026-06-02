import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  ShardInitCavesResult,
  ShardListDto,
  ShardSavePayload,
  ShardSaveResult,
} from '../../../../shared/contracts/shard'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import { resolveLocalDstInstance } from '../../shared/dst/local-dst-instance'
import {
  getShardList,
  initCavesShard,
  saveShardConfig,
} from '../../infra/game-adapter/dst/shard-service'
import { injectRestartInstance } from '../instance/inject-restart'
import { businessError, success } from '../../shared/http/response'
import { requirePermission } from '../system/auth'

const SHARD_RESOLVE_MESSAGES = {
  wrongNode: '当前仅支持本地节点实例世界配置',
  wrongGame: '当前仅支持 DST 实例世界配置',
  missingInstallPath: '实例安装目录不存在，请先在实例管理中完成安装',
  clusterDirFailed: '无法创建房间配置目录',
}

interface ShardQuery {
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

/**
 * shard 模块：DST 世界（Master/Caves server.ini、worldgen）与分片状态。
 */
export function registerShardModule(app: FastifyInstance) {
  app.get('/app/instance/shards', async (request): Promise<ApiSuccessResponse<ShardListDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = request.query as ShardQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const data = await getShardList(resolved.instance)
      return success(data, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '读取世界配置失败'
      return businessError(message, request)
    }
  })

  app.post('/app/instance/shards/init-caves', async (request): Promise<ApiSuccessResponse<ShardInitCavesResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = request.query as ShardQuery
    const instanceId = normalizeInstanceId(query.instanceId)
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const data = initCavesShard(resolved.instance, resolved.instance.gamePort)
      return success(data, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '初始化洞穴世界失败'
      return businessError(message, request)
    }
  })

  app.put('/app/instance/shards', async (request): Promise<ApiSuccessResponse<ShardSaveResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as ShardSavePayload
    const instanceId = normalizeInstanceId(body.instanceId)
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    if (!body.shard || (body.shard !== 'master' && body.shard !== 'caves')) {
      return businessError('分片类型无效', request)
    }
    try {
      const result = saveShardConfig(resolved.instance, body)
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
      const message = error instanceof Error ? error.message : '保存世界配置失败'
      return businessError(message, request)
    }
  })
}
