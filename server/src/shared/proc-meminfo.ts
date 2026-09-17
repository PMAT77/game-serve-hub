import fs from 'node:fs'

/**
 * `/proc/meminfo` 的读取与解析。
 *
 * 内存口径集中在这里：展示层（host-metrics）、启动守卫（host-resource-guard）与自检
 * 必须读同一份字段。曾经展示层用 MemFree（不含可回收的 page cache）、守卫用
 * MemAvailable，同一台 4 GiB 机器上「面板说内存 95%、守卫说还能再起一个分片」——
 * 用户只能自己登服务器 `free -h` 才知道该信谁。
 */

/**
 * 从 `/proc/meminfo` 文本里取某个字段的 KB 值。
 *
 * 抽成纯函数是为了能用**真实样本**测试：开发机是 Windows，没有 /proc，此前
 * 「读真实内存 → 判断是否放行」这条生产路径一次都没被执行过——字段名拼错或
 * 解析出 null 都会被当成「没有 swap」，直接变成一次误拒绝。
 */
export function parseMeminfoValueKb(content: string, field: string): number | null {
  const line = content.split('\n').find(item => item.startsWith(`${field}:`))
  if (!line) {
    return null
  }
  const match = line.match(/(\d+)/)
  return match ? Number(match[1]) : null
}

/** 读取真实 `/proc/meminfo`；无 /proc 的环境（Windows 原生）返回 null 字段 */
export function readProcMeminfoKb(field: string): number | null {
  try {
    return parseMeminfoValueKb(fs.readFileSync('/proc/meminfo', 'utf8'), field)
  }
  catch {
    return null
  }
}

export function kbToMb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }
  return Math.round(value / 1024)
}

export function kbToGb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }
  return Number((value / 1024 / 1024).toFixed(2))
}

/** 宿主机可用内存（MemAvailable），MiB；无 /proc 时为 null */
export function readHostMemoryAvailableMb(): number | null {
  return kbToMb(readProcMeminfoKb('MemAvailable'))
}

/** 宿主机总内存（MemTotal），MiB；无 /proc 时为 null */
export function readHostMemoryTotalMb(): number | null {
  return kbToMb(readProcMeminfoKb('MemTotal'))
}

/** 可回收的 swap 余量：MemoryHigh 触发的换页要靠它兜底，没有 swap 时内核只能直接杀进程 */
export function readHostSwapFreeMb(): number | null {
  return kbToMb(readProcMeminfoKb('SwapFree'))
}
