import fs from 'node:fs'
import type { FastifyRequest } from 'fastify'
import type { ApiErrorResponse } from '../../../../shared/contracts/api'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { ensureClusterDirectory, resolveInstanceInstallPath } from '../../infra/game-adapter/dst/cluster-service'
import { getGameInstanceById, type DbGameInstance } from '../db/index'
import { businessError } from '../http/response'

export const LOCAL_NODE_ID = 'local-node'

export type ResolvedLocalDstInstance = DbGameInstance & { installPath: string }

export type ResolveLocalDstInstanceResult =
  | { ok: true, instance: ResolvedLocalDstInstance }
  | { ok: false, error: ApiErrorResponse }

export interface ResolveLocalDstInstanceMessages {
  emptyId?: string
  notFound?: string
  wrongNode?: string
  wrongGame?: string
  missingInstallPath?: string
  clusterDirFailed?: string
}

const DEFAULT_MESSAGES: Required<ResolveLocalDstInstanceMessages> = {
  emptyId: '实例 ID 不能为空',
  notFound: '实例不存在',
  wrongNode: '当前仅支持本地节点实例',
  wrongGame: '当前仅支持 DST 实例',
  missingInstallPath: '实例安装目录不存在，请先在实例管理中完成安装',
  clusterDirFailed: '无法创建房间配置目录',
}

export async function resolveLocalDstInstance(
  instanceId: string,
  request: FastifyRequest,
  options?: {
    messages?: ResolveLocalDstInstanceMessages
    /** 为 false 时不在此处调用 ensureClusterDirectory */
    ensureClusterDirectory?: boolean
  },
): Promise<ResolveLocalDstInstanceResult> {
  const messages = { ...DEFAULT_MESSAGES, ...options?.messages }
  const id = instanceId.trim()
  if (!id) {
    return { ok: false, error: businessError(messages.emptyId, request) }
  }
  const instance = await getGameInstanceById(id)
  if (!instance) {
    return { ok: false, error: businessError(messages.notFound, request) }
  }
  if (instance.nodeId !== LOCAL_NODE_ID) {
    return { ok: false, error: businessError(messages.wrongNode, request) }
  }
  if (instance.gameCode !== DST_APP_ID) {
    return { ok: false, error: businessError(messages.wrongGame, request) }
  }
  const installPath = resolveInstanceInstallPath(instance)
  if (!fs.existsSync(installPath)) {
    return { ok: false, error: businessError(messages.missingInstallPath, request) }
  }
  if (options?.ensureClusterDirectory !== false) {
    try {
      ensureClusterDirectory(installPath)
    }
    catch {
      return { ok: false, error: businessError(messages.clusterDirFailed, request) }
    }
  }
  return {
    ok: true,
    instance: {
      ...instance,
      installPath,
    },
  }
}
