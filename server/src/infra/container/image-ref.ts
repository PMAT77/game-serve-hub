export interface ParsedImageRef {
  registry: string
  repository: string
  tag: string
  reference: string
}

export function parseImageRef(image: string): ParsedImageRef {
  const reference = image.trim()
  if (!reference) {
    throw new Error('镜像引用不能为空')
  }

  let registry = 'docker.io'
  let remainder = reference
  const slashIndex = reference.indexOf('/')
  const firstSegment = slashIndex > 0 ? reference.slice(0, slashIndex) : reference
  const looksLikeRegistry = firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost'

  if (looksLikeRegistry && slashIndex > 0) {
    registry = firstSegment
    remainder = reference.slice(slashIndex + 1)
  }

  const tagSeparator = remainder.lastIndexOf(':')
  const hasTag = tagSeparator > 0 && !remainder.slice(tagSeparator).includes('/')
  const tag = hasTag ? remainder.slice(tagSeparator + 1) : 'latest'
  const repository = hasTag ? remainder.slice(0, tagSeparator) : remainder

  return {
    registry,
    repository,
    tag,
    reference,
  }
}

/** reference 可以是 tag 或 digest，省略时用解析出的 tag */
export function buildRegistryManifestUrl(parsed: ParsedImageRef, reference?: string): string {
  const host = parsed.registry.replace(/^https?:\/\//, '')
  return `https://${host}/v2/${parsed.repository}/manifests/${reference ?? parsed.tag}`
}

export function buildRegistryBlobUrl(parsed: ParsedImageRef, digest: string): string {
  const host = parsed.registry.replace(/^https?:\/\//, '')
  return `https://${host}/v2/${parsed.repository}/blobs/${digest}`
}

export function normalizeDigest(value: string | undefined | null): string | null {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const match = trimmed.match(/sha256:[a-f0-9]{64}/i)
  return match ? match[0].toLowerCase() : trimmed.toLowerCase()
}

export function shortDigest(digest: string | null | undefined): string | null {
  if (!digest) {
    return null
  }
  const normalized = normalizeDigest(digest)
  if (!normalized) {
    return null
  }
  return normalized.replace(/^sha256:/, '').slice(0, 12)
}
