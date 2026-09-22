import type { FastifyInstance, FastifyRequest } from 'fastify'

export interface PluginInstanceOperationResult {
  ok: boolean
  message?: string
}

/**
 * 供插件调用的实例操作通道。
 *
 * 为什么走注册表而不是让插件直接打面板 HTTP 接口：面板接口按登录账号鉴权，
 * 插件没有账号；而把模拟出来的"管理员令牌"交给插件进程，等于把面板全部权限
 * 塞进一个第三方进程。这里只暴露三个明确的操作，且每次调用都由宿主侧的
 * 能力服务先做能力检查、再记审计。
 *
 * 与计划任务共用同一套做法（见 `scheduled-entry.ts`）：注册表由 instance 模块
 * 在闭包里填实现，其余模块经此调用，避免各模块互相引用内部 handler。
 */
export interface PluginInstanceOps {
  start: (app: FastifyInstance, instanceId: string) => Promise<PluginInstanceOperationResult>
  stop: (app: FastifyInstance, instanceId: string) => Promise<PluginInstanceOperationResult>
  restart: (app: FastifyInstance, instanceId: string) => Promise<PluginInstanceOperationResult>
}

let registered: PluginInstanceOps | null = null

export function registerPluginInstanceOps(impl: PluginInstanceOps | null): void {
  registered = impl
}

export function resolvePluginInstanceOps(): PluginInstanceOps | null {
  return registered
}

/** 构造一个"内部来源"的请求对象：面板内部调用不经过登录鉴权，权限由能力服务把关 */
export function buildInternalInstanceRequest(instanceId: string, action: string): FastifyRequest {
  return {
    id: `plugin-internal-${action}`,
    url: `/internal/plugin/${action}`,
    headers: {},
    body: { id: instanceId },
  } as unknown as FastifyRequest
}
