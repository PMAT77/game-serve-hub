import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import process from 'node:process'
import { createServerApp } from './app'
import { startScheduleScheduler } from './modules/schedule/scheduler'
import { syncPanelPortSettingIfStale } from './modules/system/panel-port'
import { writeAdminCredentialsFile } from './shared/config/credentials-file'
import { ensureServerRuntimeDirs, loadServerConfig } from './shared/config'
import { initDatabase } from './shared/db/index'
import { resolveRepoRoot } from './shared/repo-root'

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

  // 打包后 bundle 位于 dist-server/，固定相对路径失效；改从仓库根定位（server/drizzle）
  const migrationsFolder = path.resolve(resolveRepoRoot(), 'server/drizzle')
  const dbFilePath = await initDatabase(config.dbPath, migrationsFolder, {
    forcePasswordChange: config.forcePasswordChange,
    adminUsername: config.adminUsername,
    adminPassword: config.adminPassword,
    syncAdminPasswordFromEnv: config.syncAdminPasswordFromEnv,
    seedDevelopmentUsers: config.mode !== 'production',
  })
  if (config.adminPasswordGenerated) {
    // 初始密码只落 0600 凭据文件，绝不写入日志（journald/日志采集管道不可信）。
    const credentialsFile = writeAdminCredentialsFile(config.dbPath, config.adminUsername, config.adminPassword)
    app.log.warn(
      `生产环境未配置 ADMIN_PASSWORD，已为管理员「${config.adminUsername}」自动生成初始密码，已写入 0600 权限凭据文件（请立即读取保存，首次登录改密后可删除）: ${credentialsFile}`,
    )
  }
  await syncPanelPortSettingIfStale({ mode: config.mode })

  // 计划任务调度器必须在数据库初始化之后启动：
  // 启动恢复要读 scheduled_tasks 并把面板离线期间错过的任务标记为 skipped 顺延（绝不补跑）。
  // 放在 createServerApp（模块注册）里启动会因为 SQLite 尚未就绪而必然失败。
  startScheduleScheduler(app)

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

  if (process.stdin?.isTTY) {
    process.stdin.once('close', () => {
      void shutdown('stdin close')
    })
    process.stdin.once('end', () => {
      void shutdown('stdin end')
    })
    process.stdin.resume()
  }

  app.log.debug('后端进程生命周期监听已注册')
}
