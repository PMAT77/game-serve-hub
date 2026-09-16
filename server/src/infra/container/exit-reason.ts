import { resolveDstContainerResourceLimits } from './dst-container-resources'

/**
 * systemd 的 `Result` 值 → 用户能看懂的原因。
 *
 * 抽到独立模块是因为它同时被「状态对账」与「等待主世界就绪」两条路径使用：
 * 前者把原因写进实例的运行期警告，后者用它在主世界崩掉时给出可读的中止原因。
 */
export function describeSystemdExitReason(result: string | undefined, memoryCapMb?: number): string | null {
  switch (result) {
    case 'oom-kill':
      return memoryCapMb
        ? `内存不足被系统终止（该分片上限 ${memoryCapMb} MiB）`
        : '内存不足被系统终止'
    case 'exit-code':
      return '进程以非零状态退出'
    case 'signal':
      return '进程被信号终止'
    case 'timeout':
      return '启动或停止超时'
    case 'watchdog':
      return '看门狗超时'
    case 'core-dump':
      return '进程崩溃并产生核心转储'
    case 'start-limit-hit':
      return '反复重启次数已达上限，运行时已停止拉起'
    default:
      return null
  }
}

/** 分片当前的 cgroup 内存上限（MiB）；未设置时为 undefined */
export function resolveShardMemoryCapMb(): number | undefined {
  const limits = resolveDstContainerResourceLimits()
  return limits?.memory ? Math.round(limits.memory / (1024 * 1024)) : undefined
}
