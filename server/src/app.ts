import type { FastifyInstance } from 'fastify'
import type { ServerConfig } from './shared/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { registerAuthModule } from './modules/auth'
import { registerConsoleModule } from './modules/console'
import { registerInstanceModule } from './modules/instance'
import { registerNodeModule } from './modules/node'
import { registerSystemModule } from './modules/system'
import { success } from './shared/http/response'

/**
 * 创建 Fastify 服务实例。
 * 当前只提供最小可运行能力，后续在此处扩展模块注册与插件。
 */
export async function createServerApp(config: Pick<ServerConfig, 'mode' | 'logLevel' | 'port'>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      base: {
        service: 'game-server-hub-backend',
        env: config.mode,
      },
    },
  })

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'token', 'Token', 'Accept-Language'],
    credentials: true,
  })

  // 最小健康检查接口，用于联调与部署探活。
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'game-server-hub-backend',
      timestamp: new Date().toISOString(),
    }
  })

  // 最小 API 示例接口，后续模块路由统一挂到 /api 前缀下。
  app.get('/api/ping', async () => {
    return success({
      message: 'pong',
    })
  })

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error, '未捕获异常')
    reply.status(500).send({
      status: 1,
      error: '服务内部错误，请稍后重试',
      code: 'COMMON_INTERNAL_ERROR',
      data: {},
      requestId: request.id,
    })
  })

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info({
      requestId: request.id,
      statusCode: reply.statusCode,
      method: request.method,
      url: request.url,
      durationMs: reply.elapsedTime,
    }, 'request completed')
    done()
  })

  app.get('/api/meta/runtime', async () => {
    return success({
      server: {
        env: config.mode,
        logLevel: config.logLevel,
      },
    })
  })

  // 注册业务模块路由（逐步替换 mock 接口）
  registerAuthModule(app)
  registerSystemModule(app)
  registerNodeModule(app)
  registerInstanceModule(app)
  registerConsoleModule(app)

  if (config.mode === 'production') {
    const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
    void app.register(fastifyStatic, {
      root: distDir,
      prefix: '/',
    })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/app/') || request.url.startsWith('/api/') || request.url === '/health') {
        reply.status(404).send({ status: 1, error: 'Not Found' })
        return
      }
      reply.sendFile('index.html')
    })
  }

  return app
}
