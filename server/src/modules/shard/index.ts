import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import {
  shardInstanceQuerySchema,
  shardResetWorldPayloadSchema,
  shardRollbackPayloadSchema,
  shardSavePayloadSchema,
  shardSnapshotsQuerySchema,
} from '../../../../shared/contracts/shard'
import type {
  ShardInitCavesResult,
  ShardListDto,
  ShardMaintenanceResult,
  ShardSavePayload,
  ShardSaveResult,
  ShardSnapshotsDto,
} from '../../../../shared/contracts/shard'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import { resolveLocalDstInstance } from '../../shared/dst/local-dst-instance'
import {
  getShardList,
  initCavesShard,
  saveShardConfig,
} from '../../infra/game-adapter/dst/shard-service'
import { listShardSnapshots, readMaxSnapshots } from '../../infra/game-adapter/dst/world-maintenance'
import { resetShardWorld, rollbackShard } from './world-maintenance-service'
import { injectRestartInstance } from '../instance/inject-restart'
import { isInstanceContainerRunning } from '../instance/container-lifecycle'
import { businessError, success } from '../../shared/http/response'
import { requirePermission } from '../system/auth'

const SHARD_RESOLVE_MESSAGES = {
  wrongNode: '当前仅支持本地节点实例世界配置',
  wrongGame: '当前仅支持 DST 实例世界配置',
  missingInstallPath: '实例安装目录不存在，请先在实例管理中完成安装',
  clusterDirFailed: '无法创建房间配置目录',
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
    const query = shardInstanceQuerySchema.safeParse(request.query ?? {})
    if (!query.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = query.data.instanceId
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
    const query = shardInstanceQuerySchema.safeParse(request.query ?? {})
    if (!query.success) {
      return businessError('请求参数无效', request)
    }
    const instanceId = query.data.instanceId
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
    const body = shardSavePayloadSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const payload: ShardSavePayload = body.data
    const instanceId = payload.instanceId
    const resolved = await resolveLocalDstInstance(instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const result = saveShardConfig(resolved.instance, payload)
      if (payload.restart) {
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

  app.get('/app/instance/shards/snapshots', async (request): Promise<ApiSuccessResponse<ShardSnapshotsDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = shardSnapshotsQuerySchema.safeParse(request.query ?? {})
    if (!query.success) {
      return businessError('请求参数无效', request)
    }
    const resolved = await resolveLocalDstInstance(query.data.instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      const snapshots = listShardSnapshots(resolved.instance.installPath, query.data.shard)
      const maxSnapshots = readMaxSnapshots(resolved.instance.installPath)
      const running = resolved.instance.status === 'running'
        && await isInstanceContainerRunning(resolved.instance.id)
      const warnings: string[] = []
      if (snapshots.length === 0) {
        warnings.push('没有读到可用的存档点：世界首次启动后才会产生存档点')
      }
      return success({
        instanceId: resolved.instance.id,
        shard: query.data.shard,
        running,
        maxSnapshots,
        snapshots,
        warnings,
      }, request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '读取存档点失败'
      return businessError(message, request)
    }
  })

  app.post('/app/instance/shards/rollback', async (request): Promise<ApiSuccessResponse<ShardMaintenanceResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = shardRollbackPayloadSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const payload = body.data
    const resolved = await resolveLocalDstInstance(payload.instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    const outcome = await rollbackShard({
      app,
      instance: resolved.instance,
      shard: payload.shard,
      steps: payload.steps,
      backupBeforeRollback: payload.backupBeforeRollback,
    })
    if (!outcome.ok) {
      return businessError(outcome.message, request)
    }
    for (const warning of outcome.warnings) {
      app.log.warn({ instanceId: resolved.instance.id, shard: payload.shard, warning }, '世界回档提示')
    }
    return success(outcome.result, request)
  })

  app.post('/app/instance/shards/reset-world', async (request): Promise<ApiSuccessResponse<ShardMaintenanceResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = shardResetWorldPayloadSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const payload = body.data
    const resolved = await resolveLocalDstInstance(payload.instanceId, request, { messages: SHARD_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    const outcome = await resetShardWorld({
      app,
      instance: resolved.instance,
      shard: payload.shard,
      confirmName: payload.confirmName,
    })
    if (!outcome.ok) {
      return businessError(outcome.message, request)
    }
    for (const warning of outcome.warnings) {
      app.log.warn({ instanceId: resolved.instance.id, shard: payload.shard, warning }, '重置世界提示')
    }
    return success(outcome.result, request)
  })
}
