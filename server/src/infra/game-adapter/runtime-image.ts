import { pullGameDstImage } from '../container/game-dst-image'
import { DST_APP_ID } from './dst/constants'

export type GameRuntimeImageResult = { ok: true } | { ok: false, error: string }

/** 按 gameCode 确保运行环境镜像已在本地 Docker 中（幂等 pull） */
export async function ensureGameRuntimeImageReady(gameCode: string): Promise<GameRuntimeImageResult> {
  const normalized = gameCode.trim()
  if (normalized === DST_APP_ID) {
    return pullGameDstImage()
  }
  return {
    ok: false,
    error: `游戏 ${normalized} 暂无运行环境镜像配置，请联系管理员扩展适配器`,
  }
}
