import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createServerApp } from './app'
import { syncPanelPortSettingIfStale } from './modules/system/panel-port'
import { ensureServerRuntimeDirs, loadServerConfig } from './shared/config'
import { initDatabase } from './shared/db/index'

/**
 * 后端启动入口。
 * 说明：
 * - 负责启动顺序控制（配置加载 -> 依赖初始化 -> 模块注册 -> 启动监听）。
 * - 目前为骨架占位，后续按选定框架补齐。
 */
export async function bootstrap() {
  const config = loadServerConfig()
  ensureServerRuntimeDirs(config)
  const app = await createServerApp(config)
  let isClosing = false
  let isListening = false

  async function gracefulShutdown(reason: string) {
    if (isClosing) {
      return
    }
    isClosing = true
    app.log.info(`收到退出信号，准备关闭服务（${reason}）`)
    try {
      if (isListening) {
        await app.close()
      }
    }
    catch (error) {
      app.log.error(error, '服务关闭异常')
    }
    finally {
      process.exit(0)
    }
  }

  bindProcessLifecycle(app, gracefulShutdown)

  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
  const dbFilePath = await initDatabase(config.dbPath, migrationsFolder, {
    forcePasswordChange: config.forcePasswordChange,
    adminUsername: config.adminUsername,
    adminPassword: config.adminPassword,
    syncAdminPasswordFromEnv: config.syncAdminPasswordFromEnv,
    seedDevelopmentUsers: config.mode !== 'production',
  })
  if (config.adminPasswordGenerated) {
    app.log.warn(
      `生产环境未配置 ADMIN_PASSWORD，已为管理员「${config.adminUsername}」自动生成初始密码（仅此一次日志，请立即保存）: ${config.adminPassword}`,
    )
  }
  await syncPanelPortSettingIfStale(config.port)

  try {
    await app.listen({ port: config.port, host: config.host })
    isListening = true
    app.log.info(`后端配置文件: ${config.envFile}`)
    app.log.info(`SQLite 数据库已就绪: ${dbFilePath}`)
    app.log.info(`日志目录: ${config.logDir}`)
    app.log.info(`后端服务已启动: http://${config.host}:${config.port}`)
  }
  catch (error) {
    app.log.error(error, '后端服务启动失败')
    await app.close()
    throw error
  }
}

function bindProcessLifecycle(app: FastifyInstance, shutdown: (reason: string) => Promise<void>) {
  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.once('SIGHUP', () => {
    void shutdown('SIGHUP')
  })
  process.once('disconnect', () => {
    void shutdown('disconnect')
  })

  if (process.stdin) {
    process.stdin.once('close', () => {
      void shutdown('stdin close')
    })
    process.stdin.once('end', () => {
      void shutdown('stdin end')
    })
    if (process.stdin.isTTY) {
      process.stdin.resume()
    }
  }

  app.log.debug('后端进程生命周期监听已注册')
}
