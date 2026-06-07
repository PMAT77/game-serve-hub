import {
  buildRegistryManifestUrl,
  normalizeDigest,
  parseImageRef,
} from './image-ref'

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

export interface RegistryAuthOptions {
  username?: string | null
  password?: string | null
}

interface BearerChallenge {
  realm: string
  service: string
  scope: string
}

interface ManifestIndex {
  manifests?: Array<{
    digest: string
    platform?: {
      os?: string
      architecture?: string
    }
  }>
}

export function parseBearerChallenge(wwwAuthenticate: string | null | undefined): BearerChallenge | null {
  if (!wwwAuthenticate?.startsWith('Bearer ')) {
    return null
  }
  const params = new Map<string, string>()
  const body = wwwAuthenticate.slice('Bearer '.length)
  for (const part of body.split(',')) {
    const match = part.trim().match(/^(\w+)="([^"]*)"$/)
    if (match) {
      params.set(match[1], match[2])
    }
  }
  const realm = params.get('realm')
  const service = params.get('service')
  const scope = params.get('scope')
  if (!realm || !service || !scope) {
    return null
  }
  return { realm, service, scope }
}

export function resolvePreferredPlatform(): { os: string, architecture: string } {
  return {
    os: process.platform === 'win32' ? 'windows' : 'linux',
    architecture: process.arch === 'arm64' ? 'arm64' : 'amd64',
  }
}

export function pickManifestDigestFromIndex(index: ManifestIndex): string | null {
  const preferred = resolvePreferredPlatform()
  const candidates = (index.manifests ?? []).filter((item) => {
    const os = item.platform?.os ?? ''
    return os !== 'unknown'
  })
  const exact = candidates.find((item) => {
    const os = item.platform?.os ?? ''
    const architecture = item.platform?.architecture || 'amd64'
    return os === preferred.os && architecture === preferred.architecture
  })
  if (exact?.digest) {
    return normalizeDigest(exact.digest)
  }
  const linuxFallback = candidates.find((item) => {
    const os = item.platform?.os ?? ''
    const architecture = item.platform?.architecture || 'amd64'
    return os === 'linux' && architecture === preferred.architecture
  })
  if (linuxFallback?.digest) {
    return normalizeDigest(linuxFallback.digest)
  }
  const first = candidates[0]?.digest
  return first ? normalizeDigest(first) : null
}

function isManifestIndexContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false
  }
  return contentType.includes('manifest.list')
    || contentType.includes('image.index')
}

function resolveRegistryAuthOptions(auth?: RegistryAuthOptions): RegistryAuthOptions {
  return {
    username: auth?.username?.trim()
      || process.env.GSH_REGISTRY_USERNAME?.trim()
      || null,
    password: auth?.password?.trim()
      || process.env.GSH_REGISTRY_PASSWORD?.trim()
      || null,
  }
}

async function fetchBearerToken(
  challenge: BearerChallenge,
  auth: RegistryAuthOptions,
): Promise<string> {
  const url = new URL(challenge.realm)
  url.searchParams.set('service', challenge.service)
  url.searchParams.set('scope', challenge.scope)
  const headers: Record<string, string> = {}
  if (auth.username && auth.password) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
  }
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`Registry 鉴权失败 (${response.status})`)
  }
  const json = await response.json() as { token?: string, access_token?: string }
  const token = json.token?.trim() || json.access_token?.trim()
  if (!token) {
    throw new Error('Registry 未返回有效 token')
  }
  return token
}

async function fetchRegistryManifest(
  image: string,
  method: 'HEAD' | 'GET',
  auth?: RegistryAuthOptions,
): Promise<Response> {
  const parsed = parseImageRef(image)
  const url = buildRegistryManifestUrl(parsed)
  const resolvedAuth = resolveRegistryAuthOptions(auth)
  const headers: Record<string, string> = {
    Accept: MANIFEST_ACCEPT,
  }

  let response = await fetch(url, {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
  })

  if (response.status === 401) {
    const challenge = parseBearerChallenge(response.headers.get('WWW-Authenticate'))
    if (!challenge) {
      throw new Error('Registry 鉴权失败')
    }
    const token = await fetchBearerToken(challenge, resolvedAuth)
    response = await fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    })
  }

  if (!response.ok) {
    throw new Error(`Registry 返回 ${response.status}`)
  }
  return response
}

export async function fetchRemoteImageDigest(
  image: string,
  auth?: RegistryAuthOptions,
): Promise<string | null> {
  const headResponse = await fetchRegistryManifest(image, 'HEAD', auth)
  const contentType = headResponse.headers.get('content-type')
  const headDigest = normalizeDigest(
    headResponse.headers.get('docker-content-digest')
    ?? headResponse.headers.get('Docker-Content-Digest'),
  )

  if (!isManifestIndexContentType(contentType)) {
    return headDigest
  }

  const getResponse = await fetchRegistryManifest(image, 'GET', auth)
  const index = await getResponse.json() as ManifestIndex
  return pickManifestDigestFromIndex(index) ?? headDigest
}
