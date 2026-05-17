import process from 'node:process'
import { bootstrap } from './bootstrap'

/**
 * 命令行启动入口。
 */
bootstrap().catch((error) => {
  // 启动失败时设置非零退出码，让进程按标准方式退出。
  console.error('[server] 启动失败:', error)
  process.exitCode = 1
})
