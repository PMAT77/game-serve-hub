import type { FastifyInstance } from 'fastify'

export interface InstanceScheduledOperationResult {
  ok: boolean
  message?: string
}

/**
 * 计划任务所需的实例内部操作通道。
 * 实现由 instance 模块注册（闭包内可访问 handleInstanceStart 等内部能力），
 * schedule 模块经此调用，避免构造带用户 token 的 HTTP 请求。
 */
export interface InstanceScheduledOps {
  /** 停止运行中实例并重新启动（等价手动重启语义，但无需用户会话） */
  restart: (app: FastifyInstance, instanceId: string) => Promise<InstanceScheduledOperationResult>
}

let registered: InstanceScheduledOps | null = null

export function registerInstanceScheduledOps(impl: InstanceScheduledOps | null): void {
  registered = impl
}

export async function restartInstanceBySchedule(app: FastifyInstance, instanceId: string): Promise<InstanceScheduledOperationResult> {
  if (!registered) {
    return { ok: false, message: '实例模块尚未初始化，无法执行计划重启' }
  }
  return registered.restart(app, instanceId)
}
