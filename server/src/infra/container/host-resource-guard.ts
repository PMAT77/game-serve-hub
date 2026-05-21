import fs from 'node:fs'
import { resolveDstContainerResourceLimits } from './dst-container-resources'
import { resolveSteamcmdContainerMemoryCapMb } from './steamcmd-container-resources'

const MIB = 1024 * 1024

/** 守卫用：SteamCMD 安装典型峰值（MiB），与 Docker 硬上限解耦 */
const DEFAULT_STEAMCMD_PLANNING_MB = 1280
/** 守卫用：未限制 DST 容器时的启动峰值估计 */
const DEFAULT_DST_PLANNING_MB = 768
/** 守卫用：同机 seed 复制时的页缓存峰值估计 */
const DEFAULT_SEED_PLANNING_MB = 768

export type HeavyHostOperation = 'steamcmd-install' | 'dst-container-start' | 'install-seed-copy'

function readProcMeminfoKb(field: string): number | null {
  try {
    const content = fs.readFileSync('/proc/meminfo', 'utf8')
    const line = content.split('\n').find(item => item.startsWith(`${field}:`))
    if (!line) {
      return null
    }
    const match = line.match(/(\d+)/)
    return match ? Number(match[1]) : null
  }
  catch {
    return null
  }
}

function kbToMb(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }
  return Math.round(value / 1024)
}

function parsePositiveMbEnv(key: string): number | undefined {
  const raw = process.env[key]?.trim()
  if (!raw) {
    return undefined
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return Math.floor(parsed)
}

/**
 * 安装前内存守卫用的 SteamCMD 峰值估计（非 Docker Memory 上限）。
 * 实际上 SteamCMD 常态占用通常几百 MiB；上限仅在瞬时冲高时触发 OOM。
 */
export function resolveSteamcmdPlanningMb(): number {
  const explicit = parsePositiveMbEnv('GSH_HOST_STEAMCMD_PLANNING_MB')
  if (explicit !== undefined) {
    return explicit
  }
  const capMb = resolveSteamcmdContainerMemoryCapMb('app-update')
  if (capMb === undefined) {
    return DEFAULT_STEAMCMD_PLANNING_MB
  }
  // 守卫按典型峰值估算；即使用户设了很高硬上限，也不按上限占满来拦截
  return Math.min(capMb, DEFAULT_STEAMCMD_PLANNING_MB)
}

function resolveDstPlanningMb(): number {
  const explicit = parsePositiveMbEnv('GSH_HOST_DST_PLANNING_MB')
  if (explicit !== undefined) {
    return explicit
  }
  const limits = resolveDstContainerResourceLimits()
  if (limits?.memory) {
    const capMb = Math.round(limits.memory / MIB)
    return Math.min(capMb, DEFAULT_DST_PLANNING_MB)
  }
  return DEFAULT_DST_PLANNING_MB
}

function resolveSeedPlanningMb(): number {
  return parsePositiveMbEnv('GSH_HOST_SEED_PLANNING_MB') ?? DEFAULT_SEED_PLANNING_MB
}

function resolveHostMemoryHeadroomMb(): number {
  return parsePositiveMbEnv('GSH_HOST_MEMORY_HEADROOM_MB') ?? 512
}

/** 执行重操作前要求宿主机（面板容器 /proc）剩余可用内存下限（MiB） */
export function resolveMinHostAvailableMbForOperation(operation: HeavyHostOperation): number {
  const override = parsePositiveMbEnv('GSH_HOST_MIN_AVAILABLE_MB')
  if (override !== undefined) {
    return override
  }
  const headroomMb = resolveHostMemoryHeadroomMb()
  switch (operation) {
    case 'steamcmd-install':
      return resolveSteamcmdPlanningMb() + headroomMb
    case 'dst-container-start':
      return resolveDstPlanningMb() + Math.min(headroomMb, 384)
    case 'install-seed-copy':
      return resolveSeedPlanningMb() + headroomMb
    default:
      return 1024
  }
}

export function readHostMemoryAvailableMb(): number | null {
  return kbToMb(readProcMeminfoKb('MemAvailable'))
}

export function readHostMemoryTotalMb(): number | null {
  return kbToMb(readProcMeminfoKb('MemTotal'))
}

export type HostMemoryPressureResult =
  | { ok: true, availableMb: number | null, requiredMb: number }
  | { ok: false, availableMb: number | null, requiredMb: number, message: string }

/**
 * 在面板容器内读取 MemAvailable，避免 SteamCMD 与 DST 同时压垮小内存宿主机。
 * Windows 原生进程模式无 /proc 时跳过检查。
 */
export function assessHostMemoryForHeavyOperation(operation: HeavyHostOperation): HostMemoryPressureResult {
  const requiredMb = resolveMinHostAvailableMbForOperation(operation)
  const availableMb = readHostMemoryAvailableMb()
  const totalMb = readHostMemoryTotalMb()
  if (availableMb === null) {
    return { ok: true, availableMb: null, requiredMb }
  }
  if (availableMb >= requiredMb) {
    return { ok: true, availableMb, requiredMb }
  }
  const capMb = resolveSteamcmdContainerMemoryCapMb('app-update')
  const capHint = capMb ? `SteamCMD 容器硬上限 ${capMb} MiB（非预留）；` : ''
  const totalHint = totalMb ? `（总内存约 ${totalMb} MiB）` : ''
  const message = [
    `宿主机可用内存不足：当前约 ${availableMb} MiB，执行该操作建议至少 ${requiredMb} MiB${totalHint}。`,
    `${capHint}安装/启动按典型峰值估算，非按上限占满。`,
    '可先停止其他实例、启用同机 seed 复制跳过 Steam 下载，或设 GSH_HOST_MIN_AVAILABLE_MB=0 关闭守卫（小内存机慎用）。',
    '小内存机可在 panel.env 设置 GSH_STEAMCMD_CONTAINER_MEMORY_MB 上限；高配机保持不设置即可。',
  ].join('')
  return { ok: false, availableMb, requiredMb, message }
}
