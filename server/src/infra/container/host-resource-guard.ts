import type { HostMemoryPressureData } from '../../../../shared/contracts/host-memory-pressure'
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

export type HostMemoryPressureFailure = {
  ok: false
  availableMb: number
  requiredMb: number
  summary: string
  detail: string
  data: HostMemoryPressureData
}

export type HostMemoryPressureResult =
  | { ok: true, availableMb: number | null, requiredMb: number }
  | HostMemoryPressureFailure

function buildHostMemoryPressureFailure(
  availableMb: number,
  requiredMb: number,
  totalMb: number | null,
  capMb: number | undefined,
): HostMemoryPressureFailure {
  const totalHint = totalMb ? `（总内存约 ${totalMb} MiB）` : ''
  const explanationLines = [
    '说明：安装/启动按典型峰值估算，并非按容器上限占满内存。',
    ...(capMb ? [`SteamCMD 容器内存硬上限为 ${capMb} MiB（非预留占用）。`] : []),
  ]
  const detail = [
    `当前可用约 ${availableMb} MiB，本操作建议至少 ${requiredMb} MiB${totalHint}。`,
    '',
    ...explanationLines,
    '',
    '建议：',
    '1. 停止其他正在运行的实例，释放内存',
    '2. 启用同机 seed 复制，跳过 Steam 下载',
    '3. 小内存机可在 panel.env 设置 GSH_STEAMCMD_CONTAINER_MEMORY_MB 限制 SteamCMD 容器内存（高配机可不设置）',
    '',
    '若确需强制执行：在 panel.env 设置 GSH_HOST_MIN_AVAILABLE_MB=0 可关闭内存守卫（小内存机慎用，可能触发 OOM）。',
  ].join('\n')
  const summary = `宿主机可用内存不足（当前约 ${availableMb} MiB，建议至少 ${requiredMb} MiB${totalHint}）`
  const data: HostMemoryPressureData = {
    availableMb,
    requiredMb,
    totalMb,
    capMb: capMb ?? null,
    detail,
  }
  return { ok: false, availableMb, requiredMb, summary, detail, data }
}

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
  return buildHostMemoryPressureFailure(availableMb, requiredMb, totalMb, capMb)
}
