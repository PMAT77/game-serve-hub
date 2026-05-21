/** Docker HostConfig.Memory / MemorySwap（字节）。MemorySwap === Memory 表示禁用 swap */

export interface SteamcmdContainerMemoryLimits {
  Memory: number
  MemorySwap: number
}

const MIB = 1024 * 1024

function parsePositiveMb(raw: string | undefined, fallbackMb: number): number {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return fallbackMb
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMb
  }
  return Math.floor(parsed)
}

/** app_update 默认 8GiB；app_info 默认 512MiB。设 0 表示不限制（不推荐生产/dev 大文件安装） */
export function resolveSteamcmdContainerMemoryLimits(
  kind: 'app-update' | 'app-info',
): SteamcmdContainerMemoryLimits | undefined {
  const envKey = kind === 'app-update'
    ? 'GSH_STEAMCMD_CONTAINER_MEMORY_MB'
    : 'GSH_STEAMCMD_APP_INFO_MEMORY_MB'
  const defaultMb = kind === 'app-update' ? 8192 : 512
  const raw = process.env[envKey]?.trim()
  if (raw === '0') {
    return undefined
  }
  const memoryMb = parsePositiveMb(raw, defaultMb)
  const swapRaw = process.env.GSH_STEAMCMD_CONTAINER_MEMORY_SWAP_MB?.trim()
  const swapMb = swapRaw === '0' || !swapRaw
    ? memoryMb
    : parsePositiveMb(swapRaw, memoryMb)
  return {
    Memory: memoryMb * MIB,
    MemorySwap: swapMb * MIB,
  }
}

export function formatSteamcmdMemoryLimitForLog(limits: SteamcmdContainerMemoryLimits | undefined): string {
  if (!limits) {
    return '未设置（使用 Docker 默认，可能导致 WSL2 内存暴涨）'
  }
  const memoryGiB = (limits.Memory / 1024 / 1024 / 1024).toFixed(2)
  const swapDisabled = limits.MemorySwap === limits.Memory
  return `${memoryGiB} GiB${swapDisabled ? '（禁用 swap）' : ''}`
}
