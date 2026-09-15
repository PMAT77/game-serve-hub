import type { FastifyInstance } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import {
  playerListQuerySchema,
  playerListSavePayloadSchema,
} from '../../../../shared/contracts/player'
import type {
  PlayerListDto,
  PlayerListSaveResult,
} from '../../../../shared/contracts/player'
import { NODE_INSTANCE_MANAGE_PERMISSION } from '../../shared/menu-routes'
import { resolveLocalDstInstance } from '../../shared/dst/local-dst-instance'
import { getPlayerList, savePlayerListForInstance } from '../../infra/game-adapter/dst/player-service'
import { businessError, success } from '../../shared/http/response'
import { requirePermission } from '../system/auth'

const PLAYER_RESOLVE_MESSAGES = {
  wrongNode: '当前仅支持本地节点实例的玩家名单',
  wrongGame: '当前仅支持 DST 实例的玩家名单',
  missingInstallPath: '实例安装目录不存在，请先在实例管理中完成安装',
  clusterDirFailed: '无法创建房间配置目录',
}

/**
 * player 模块：DST 玩家名单（adminlist.txt / blocklist.txt / whitelist.txt）。
 *
 * 只做名单文件的结构化读写；在线玩家列表与踢人 / 封禁需要向游戏进程下发命令，
 * 待实机确认 TheNet:GetClientTable() 的字段后另行接入。
 */
export function registerPlayerModule(app: FastifyInstance) {
  app.get('/app/instance/players', async (request): Promise<ApiSuccessResponse<PlayerListDto> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const query = playerListQuerySchema.safeParse(request.query ?? {})
    if (!query.success) {
      return businessError('请求参数无效', request)
    }
    const resolved = await resolveLocalDstInstance(query.data.instanceId, request, { messages: PLAYER_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      return success(getPlayerList(resolved.instance, query.data.kind), request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '读取玩家名单失败'
      return businessError(message, request)
    }
  })

  app.put('/app/instance/players', async (request): Promise<ApiSuccessResponse<PlayerListSaveResult> | ApiErrorResponse> => {
    const authError = await requirePermission(request, NODE_INSTANCE_MANAGE_PERMISSION)
    if (authError) {
      return authError
    }
    const body = playerListSavePayloadSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const payload = body.data
    const resolved = await resolveLocalDstInstance(payload.instanceId, request, { messages: PLAYER_RESOLVE_MESSAGES })
    if (!resolved.ok) {
      return resolved.error
    }
    try {
      return success(savePlayerListForInstance(resolved.instance, payload.kind, payload.entries), request)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '保存玩家名单失败'
      return businessError(message, request)
    }
  })
}
