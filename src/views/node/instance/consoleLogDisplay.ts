import type { InstanceConsoleLogLine, InstanceConsoleLogShard } from '@/api/modules/instance'

const CONSOLE_LOG_SHARD_LABEL: Record<InstanceConsoleLogShard, string> = {
  master: '地上',
  caves: '洞穴',
}

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
