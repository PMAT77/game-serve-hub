import type { FastifyInstance } from 'fastify'

/**
 * 实例 HTTP 路由注册（从 index 逐步迁入）。
 * 当前仍由 registerInstanceModule 内联注册；本文件预留拆分落点。
 */
export function registerInstanceRoutes(_app: FastifyInstance) {
  // 路由注册见 registerInstanceModule（instance/index.ts）
}
