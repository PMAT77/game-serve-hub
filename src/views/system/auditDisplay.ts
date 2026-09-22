/**
 * 审计记录的展示口径。
 *
 * 插件调用记录与面板操作记录来自两个接口（`/app/system/plugins/audit` 与
 * `/app/system/audit/operations`），但「成功 / 被拒 / 失败」的语义、时间格式与
 * 参数摘要的形状完全一致，所以合并在这里——两份各自维护的映射迟早会漂移。
 */

export type AuditOutcomeTone = 'success' | 'warning' | 'error'

export interface AuditOutcomeMeta {
  label: string
  type: AuditOutcomeTone
}

/** 被拒的操作是最需要管理员看一眼的事件，用 warning 而不是 default */
export const AUDIT_OUTCOME_META: Record<string, AuditOutcomeMeta> = {
  ok: { label: '成功', type: 'success' },
  denied: { label: '被拒', type: 'warning' },
  error: { label: '失败', type: 'error' },
}

/** 时间戳解析不出来时原样显示，而不是显示 Invalid Date */
export function formatAuditTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/** 参数摘要：pluginId 已在同一行的插件名里显示过，这里不再重复 */
export function formatAuditParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([key]) => key !== 'pluginId')
  if (entries.length === 0) {
    return ''
  }
  return entries.map(([key, value]) => `${key}=${String(value)}`).join('　')
}
