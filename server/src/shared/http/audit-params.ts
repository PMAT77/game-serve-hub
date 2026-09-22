/**
 * 审计参数摘要的共用规则。
 *
 * 为什么抽成单独一层：插件调用审计（`server/src/plugins/audit-store.ts`）与用户操作审计
 * 都要把请求参数压成一行可读摘要，且都**必须脱敏**——审计文件会被打包反馈、贴进群里、
 * 交给客户或第三方审计。两处各写一份的话，漏掉一个键名就等于泄一次凭据。
 */

/** 这些键一律不记原值（大小写不敏感的子串匹配） */
export const AUDIT_SENSITIVE_KEY_PATTERNS = [
  'token',
  'password',
  'passwd',
  'secret',
  'key',
  'authorization',
  'cookie',
  'credential',
]

/** 单个值的最长长度：审计是为了追责，不是为了留档原始请求体 */
export const AUDIT_MAX_VALUE_LENGTH = 200
export const AUDIT_MAX_KEYS = 12

export type AuditParamValue = string | number | boolean | null
export type AuditParamSummary = Record<string, AuditParamValue>

export function isSensitiveAuditKey(key: string): boolean {
  const lower = key.toLowerCase()
  return AUDIT_SENSITIVE_KEY_PATTERNS.some(pattern => lower.includes(pattern))
}

/**
 * 生成参数摘要：只保留标量、截断长值、剔除敏感键；
 * 嵌套对象与数组只记录形状（`{3 个字段}` / `[2 项]`）。
 */
export function summarizeAuditParams(params: unknown): AuditParamSummary {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {}
  }
  const summary: AuditParamSummary = {}
  const entries = Object.entries(params as Record<string, unknown>)
  for (const [key, value] of entries.slice(0, AUDIT_MAX_KEYS)) {
    if (isSensitiveAuditKey(key)) {
      summary[key] = '[已隐去]'
      continue
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      summary[key] = value
      continue
    }
    if (typeof value === 'string') {
      summary[key] = value.length > AUDIT_MAX_VALUE_LENGTH
        ? `${value.slice(0, AUDIT_MAX_VALUE_LENGTH)}…`
        : value
      continue
    }
    if (Array.isArray(value)) {
      summary[key] = `[${value.length} 项]`
      continue
    }
    if (typeof value === 'object') {
      summary[key] = `{${Object.keys(value as Record<string, unknown>).length} 个字段}`
      continue
    }
    summary[key] = String(value)
  }
  if (entries.length > AUDIT_MAX_KEYS) {
    summary.__truncated = `另有 ${entries.length - AUDIT_MAX_KEYS} 个参数未记录`
  }
  return summary
}
