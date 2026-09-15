import type { InstanceConsoleLogFilter, InstanceConsoleLogLine, InstanceConsoleLogShard } from '@/api/modules/instance'

const CONSOLE_LOG_SHARD_LABEL: Record<InstanceConsoleLogShard, string> = {
  master: '地上',
  caves: '洞穴',
}

/** 命令回显行的前缀：后端写入容器 stdin 后补写一条「> 命令」的 system 行 */
const COMMAND_ECHO_PREFIX = '> '

export function consoleLogShardLabel(shard?: InstanceConsoleLogShard | null): string {
  if (!shard) {
    return ''
  }
  return CONSOLE_LOG_SHARD_LABEL[shard]
}

export function formatConsoleLogLineForCopy(line: InstanceConsoleLogLine): string {
  const tag = consoleLogShardLabel(line.shard)
  const prefix = tag ? `[${tag}] ` : ''
  return `${prefix}${line.text}`
}

/**
 * 是否为面板下发的命令回显。
 *
 * 回显与命令结果（游戏 stdout）在合并后的单一控制台视图里靠这个前缀区分并强调，
 * 让用户能顺着回显找到紧随其后的输出。
 */
export function isCommandEcho(line: InstanceConsoleLogLine): boolean {
  return line.stream === 'system' && line.text.startsWith(COMMAND_ECHO_PREFIX)
}

/**
 * 控制台视图的日志流过滤。
 *
 * 实时日志流推的是全量行，过滤放在前端做：语义必须与后端
 * `filterConsoleLines` / `instanceConsoleLogFilterSchema` 保持一致，
 * 否则「面板消息 / 游戏输出」两档会与接口口径产生偏差。
 */
export function filterConsoleLines(
  lines: InstanceConsoleLogLine[],
  filter: InstanceConsoleLogFilter,
): InstanceConsoleLogLine[] {
  if (filter === 'all') {
    return lines
  }
  if (filter === 'game') {
    return lines.filter(line => line.stream === 'stdout' || line.stream === 'stderr')
  }
  return lines.filter(line => line.stream === 'system')
}
