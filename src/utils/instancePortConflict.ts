import type { InstancePortConflictData } from '@/api/modules/instance'

/** 与 shared/constants/error-code.ts 中 INSTANCE_PORT_CONFLICT 保持一致 */
export const INSTANCE_PORT_CONFLICT_CODE = 'INSTANCE_PORT_CONFLICT'

export interface RejectedApiPayload {
  status?: number
  error?: string
  code?: string
  data?: InstancePortConflictData
}

export function isInstancePortConflictError(payload: unknown): payload is RejectedApiPayload & {
  code: typeof INSTANCE_PORT_CONFLICT_CODE
  error: string
  data: InstancePortConflictData
} {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const p = payload as RejectedApiPayload
  return p.code === INSTANCE_PORT_CONFLICT_CODE && typeof p.error === 'string'
}

export type InstancePortConflictAction = 'start' | 'restart'

export function getPortConflictDialogLabels(action: InstancePortConflictAction) {
  if (action === 'restart') {
    return {
      title: '端口被占用，无法重启',
      positiveText: '自动分配并重启',
      successToast: '实例已重启',
    }
  }
  return {
    title: '端口被占用，无法启动',
    positiveText: '自动分配并启动',
    successToast: '实例已启动',
  }
}

export function formatPortConflictDetail(data: InstancePortConflictData): string {
  const ports = Array.isArray(data.conflictingPorts)
    ? [...data.conflictingPorts].sort((a, b) => a - b)
    : []
  const portText = ports.length > 0 ? ports.join('、') : '部分'
  const suggest = data.suggestedGamePort != null
    ? `自动分配后，主世界游戏端口将约为 ${data.suggestedGamePort}（Steam 等端口会一并调整）。`
    : '自动分配将为该实例选择一组同节点未占用的端口。'
  return `端口 ${portText} 已被本节点上运行中的其他实例占用，或当前主机上已有进程绑定该端口。继续启动会失败。${suggest}`
}
