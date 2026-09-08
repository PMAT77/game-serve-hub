import type DockerClient from 'dockerode'
import { parseImageRef } from './image-ref'

/**
 * 通用镜像候选拉取：
 * 1) 若配置了备选 registry（GSH_IMAGE_MIRRORS / 旧 GSH_STEAMCMD_IMAGE_MIRRORS），按顺序优先尝试候选；
 * 2) 最后尝试完整的已配置镜像引用。
 * v0.2.0 起面板/DST/SteamCMD 共用统一镜像，该模块由 steamcmd-runner 与 game-dst-image 共享。
 */

/** 未配置镜像引用时使用的官方默认仓库（统一镜像）。 */
export const OFFICIAL_UNIFIED_IMAGE_REPOSITORY = 'ghcr.io/pmat77/game-server-hub'

export function normalizeMirrorRegistries(raw: string | null | undefined): string[] {
  const normalized = (raw || '').trim()
  if (!normalized) {
    return []
  }
  return [...new Set(
    normalized
      .split(',')
      .map(item => item.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
      .filter(Boolean),
  )]
}

export function buildImageRef(registry: string, repository: string, tag: string): string {
  if (registry === 'docker.io') {
    return `${repository}:${tag}`
  }
  return `${registry}/${repository}:${tag}`
}

export function buildImageCandidates(configuredRef: string, mirrorsRaw: string | null | undefined): string[] {
  const ref = configuredRef.trim() || `${OFFICIAL_UNIFIED_IMAGE_REPOSITORY}:latest`
  const parsed = parseImageRef(ref)
  const mirrors = normalizeMirrorRegistries(mirrorsRaw).filter(registry => registry !== parsed.registry)
  const candidates = mirrors.map(registry => buildImageRef(registry, parsed.repository, parsed.tag))
  candidates.push(ref)
  return candidates
}

export async function isImagePresentByRef(docker: DockerClient, imageRef: string): Promise<boolean> {
  try {
    await docker.getImage(imageRef).inspect()
    return true
  }
  catch {
    return false
  }
}

export async function tagImageAlias(docker: DockerClient, sourceRef: string, targetRef: string): Promise<void> {
  if (sourceRef === targetRef) {
    return
  }
  const parsed = parseImageRef(targetRef)
  const repo = parsed.registry === 'docker.io'
    ? parsed.repository
    : `${parsed.registry}/${parsed.repository}`
  await docker.getImage(sourceRef).tag({ repo, tag: parsed.tag })
}

export function pullImageOnce(docker: DockerClient, image: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

export interface PullCandidatesOptions {
  maxAttempts?: number
  retryBaseMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type PullCandidatesResult
  = | { ok: true, image: string }
    | { ok: false, error: string, tried: string[] }

/** 按候选顺序拉取：本地已有则直接 tag 别名；否则逐候选重试拉取。 */
export async function pullImageWithCandidates(
  docker: DockerClient,
  candidates: string[],
  targetRef: string,
  options: PullCandidatesOptions = {},
): Promise<PullCandidatesResult> {
  const maxAttempts = options.maxAttempts ?? 3
  const retryBaseMs = options.retryBaseMs ?? 2_000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  for (const candidate of candidates) {
    if (await isImagePresentByRef(docker, candidate)) {
      await tagImageAlias(docker, candidate, targetRef)
      return { ok: true, image: candidate }
    }
  }

  let lastError = ''
  const tried: string[] = []
  for (const candidate of candidates) {
    tried.push(candidate)
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await pullImageOnce(docker, candidate)
        await tagImageAlias(docker, candidate, targetRef)
        return { ok: true, image: candidate }
      }
      catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (attempt < maxAttempts) {
          await sleep(retryBaseMs * attempt)
        }
      }
    }
  }
  return {
    ok: false,
    error: lastError || `拉取 ${candidates[candidates.length - 1] || targetRef} 失败`,
    tried,
  }
}

/** 构建拉取失败的通用提示（网络/权限/镜像不存在分类）。 */
export function formatPullError(raw: string, image: string, triedImages?: string[], envHint = 'GSH_IMAGE_MIRRORS'): string {
  const text = raw.trim() || `拉取 ${image} 失败`
  const attempted = triedImages?.length ? `已尝试镜像：${triedImages.join(' -> ')}。` : ''
  if (/403 Forbidden|denied|unauthorized/i.test(text)) {
    return `${attempted}镜像仓库拒绝访问（403/unauthorized），请检查镜像可见性或更换可访问镜像。原始错误：${text}`
  }
  if (/registry-1\.docker\.io|docker\.io|connectex|ETIMEDOUT|timeout|deadline|ECONNREFUSED|failed to respond/i.test(text)) {
    return [
      attempted,
      `无法从镜像仓库拉取镜像 ${image}（网络超时或被阻断）。`,
      `可尝试：① 在可访问网络下手动 docker pull 后重试；`,
      `② 在 panel.env 中配置 ${envHint} 指向可达 registry；`,
      `③ 检查镜像引用的 tag 是否与发布一致。`,
      `原始错误：${text}`,
    ].join('')
  }
  if (/manifest unknown|not found|404/i.test(text)) {
    return `${attempted}镜像 ${image} 不存在或标签错误，请检查镜像引用配置。原始错误：${text}`
  }
  return `${attempted}${text}`
}
