import DockerClient from 'dockerode'
import { resolveDockerConnectOptions } from '../docker-connect'
import { getServerContainerConfig } from '../../shared/config/container'

export type GameDstImagePullResult = { ok: true } | { ok: false, error: string }

let gameDstImagePullInFlight: Promise<GameDstImagePullResult> | null = null

function resolveDocker() {
  const { dockerHost } = getServerContainerConfig()
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

async function pullImageOnce(image: string): Promise<void> {
  const docker = resolveDocker()
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (pullError: Error | null, stream: NodeJS.ReadableStream) => {
      if (pullError) {
        reject(pullError)
        return
      }
      docker.modem.followProgress(stream, (progressError: Error | null) => {
        if (progressError) {
          reject(progressError)
        }
        else {
          resolve()
        }
      })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function formatGameDstImageError(text: string, image: string): string {
  if (/denied|unauthorized|403|401/i.test(text)) {
    return [
      `无法从仓库拉取 DST 运行镜像（${image}），可能为私有镜像或未登录 GHCR。`,
      '可在项目根目录本地构建：',
      `docker build -t ${image} docker/game-dst`,
    ].join('\n')
  }
  if (/no such image|manifest unknown|not found|404/i.test(text)) {
    return [
      `DST 运行镜像未就绪：${image}`,
      '面板启动实例时会自动尝试拉取；若仍失败，可在宿主机执行：',
      `docker pull ${image}`,
      '或本地构建：',
      `docker build -t ${image} docker/game-dst`,
    ].join('\n')
  }
  return text
}

export async function isGameDstImagePresent(): Promise<boolean> {
  try {
    const { gameDstImage } = getServerContainerConfig()
    await resolveDocker().getImage(gameDstImage).inspect()
    return true
  }
  catch {
    return false
  }
}

const PULL_MAX_ATTEMPTS = 3
const PULL_RETRY_BASE_MS = 2_000

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
    let lastError = ''
    for (let attempt = 1; attempt <= PULL_MAX_ATTEMPTS; attempt++) {
      try {
        await pullImageOnce(gameDstImage)
        return { ok: true }
      }
      catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (attempt < PULL_MAX_ATTEMPTS) {
          await sleep(PULL_RETRY_BASE_MS * attempt)
        }
      }
    }
    return { ok: false, error: formatGameDstImageError(lastError, gameDstImage) }
  })().finally(() => {
    gameDstImagePullInFlight = null
  })
  return gameDstImagePullInFlight
}
