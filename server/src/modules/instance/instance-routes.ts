import type { FastifyInstance } from 'fastify'

export type InstanceRouteRegistrar = (app: FastifyInstance) => void

/**
 * 实例 HTTP 路由边界。
 *
 * 模块入口只负责装配，具体的路由注册由此边界接管；后续可按查询、安装、
 * 生命周期等职责迁移注册函数，而无需再改动 app.ts。
 */
export function registerInstanceRoutes(app: FastifyInstance, register: InstanceRouteRegistrar) {
  register(app)
}
