import DockerClient from 'dockerode'
import { resolveDockerConnectOptions } from '../docker-connect'
import { getServerContainerConfig } from '../../shared/config/container'
import {
  buildImageCandidates,
  formatPullError,
  isImagePresentByRef,
  pullImageWithCandidates,
} from './image-candidates'

export type GameDstImagePullResult = { ok: true } | { ok: false, error: string }

let gameDstImagePullInFlight: Promise<GameDstImagePullResult> | null = null

function resolveDocker(): DockerClient {
  const { dockerHost } = getServerContainerConfig()
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

export function formatGameDstImageError(text: string, image: string): string {
  if (/denied|unauthorized|403|401/i.test(text)) {
    return [
      `无法从仓库拉取 DST 运行镜像（${image}），可能为私有镜像或未登录镜像仓库。`,
      '可在宿主机执行：',
      `docker pull ${image}`,
    ].join('\n')
  }
  if (/no such image|manifest unknown|not found|404/i.test(text)) {
    return [
      `DST 运行镜像未就绪：${image}`,
      '面板启动实例时会自动尝试拉取；若仍失败，可在宿主机执行：',
      `docker pull ${image}`,
    ].join('\n')
  }
  return text
}

export async function isGameDstImagePresent(): Promise<boolean> {
  try {
    const { gameDstImage } = getServerContainerConfig()
    if (await isImagePresentByRef(resolveDocker(), gameDstImage)) {
      return true
    }
    return false
  }
  catch {
    return false
  }
}

const PULL_MAX_ATTEMPTS = 3
const PULL_RETRY_BASE_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveDstMirrorsRaw(): string {
  const { imageMirrors } = getServerContainerConfig()
  if (imageMirrors.length > 0) {
    return imageMirrors.join(',')
  }
  return ''
}

/** 幂等拉取；启动实例或初始化运行时时调用，勿在列表轮询中调用 */
export async function pullGameDstImage(options?: { force?: boolean }): Promise<GameDstImagePullResult> {
  const force = options?.force ?? false
  if (!force && await isGameDstImagePresent()) {
    return { ok: true }
  }
  if (gameDstImagePullInFlight) {
    return gameDstImagePullInFlight
  }
  const { gameDstImage } = getServerContainerConfig()
  gameDstImagePullInFlight = (async (): Promise<GameDstImagePullResult> => {
    const candidates = buildImageCandidates(gameDstImage, resolveDstMirrorsRaw())
    const result = await pullImageWithCandidates(resolveDocker(), candidates, gameDstImage, {
      maxAttempts: PULL_MAX_ATTEMPTS,
      retryBaseMs: PULL_RETRY_BASE_MS,
      sleep,
    })
    if (result.ok) {
      return { ok: true }
    }
    return { ok: false, error: formatGameDstImageError(formatPullError(result.error, gameDstImage, result.tried), gameDstImage) }
  })().finally(() => {
    gameDstImagePullInFlight = null
  })
  return gameDstImagePullInFlight
}
