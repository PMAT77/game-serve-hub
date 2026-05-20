import fs from 'node:fs'
import { writeFileAtomic } from './atomic-write'

const CLUSTER_TOKEN_PREFIX = 'pds-'
const CLUSTER_TOKEN_MIN_LENGTH = 8
const CLUSTER_TOKEN_MAX_LENGTH = 512

export function normalizeClusterToken(raw: string): string {
  return raw.trim().split(/\r?\n/)[0]?.trim() ?? ''
}

/** Klei 令牌常见为 pds- 前缀 + Base64 类字符（含 _ ^ = 等） */
const CLUSTER_TOKEN_BODY_PATTERN = /^pds-[A-Za-z0-9_^=\-+/]+$/

export function validateClusterToken(token: string): string | undefined {
  const normalized = normalizeClusterToken(token)
  if (!normalized) {
    return 'Klei 集群令牌不能为空'
  }
  if (!normalized.startsWith(CLUSTER_TOKEN_PREFIX)) {
    return 'Klei 集群令牌格式无效，应以 pds- 开头'
  }
  if (normalized.length < CLUSTER_TOKEN_MIN_LENGTH || normalized.length > CLUSTER_TOKEN_MAX_LENGTH) {
    return 'Klei 集群令牌长度无效'
  }
  if (!CLUSTER_TOKEN_BODY_PATTERN.test(normalized)) {
    return 'Klei 集群令牌包含非法字符'
  }
  return undefined
}

export function maskClusterToken(token: string): string {
  const normalized = normalizeClusterToken(token)
  if (!normalized) {
    return ''
  }
  if (normalized.length <= 8) {
    return `${CLUSTER_TOKEN_PREFIX}****`
  }
  const tail = normalized.slice(-4)
  return `${CLUSTER_TOKEN_PREFIX}****${tail}`
}

export function readClusterTokenFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const normalized = normalizeClusterToken(content)
  return normalized || null
}

export function writeClusterTokenFile(filePath: string, token: string): void {
  const normalized = normalizeClusterToken(token)
  const error = validateClusterToken(normalized)
  if (error) {
    throw new Error(error)
  }
  writeFileAtomic(filePath, `${normalized}\n`)
}
