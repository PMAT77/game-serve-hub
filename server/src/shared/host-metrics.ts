import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface HostResourceSnapshot {
  cpu: {
    cores: number
    usageRate: number
    availableRate: number
  }
  memory: {
    totalGb: number
    usedGb: number
    freeGb: number
    usageRate: number
  }
  disk: {
    totalGb: number
    usedGb: number
    freeGb: number
    usageRate: number
  }
}

let previousCpuTotal = 0
let previousCpuIdle = 0

export function toGb(value: number) {
  return Number((value / 1024 / 1024 / 1024).toFixed(2))
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

export function getCpuUsageRate() {
  const cpuInfo = os.cpus()
  const total = cpuInfo.reduce((sum, core) => {
    return sum + core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq
  }, 0)
  const idle = cpuInfo.reduce((sum, core) => sum + core.times.idle, 0)

  let usageRate = 0
  if (previousCpuTotal > 0 && total > previousCpuTotal) {
    const totalDelta = total - previousCpuTotal
    const idleDelta = idle - previousCpuIdle
    usageRate = totalDelta > 0
      ? ((totalDelta - idleDelta) / totalDelta) * 100
      : 0
  }
  else {
    usageRate = total > 0
      ? ((total - idle) / total) * 100
      : 0
  }

  previousCpuTotal = total
  previousCpuIdle = idle
  return Number(clampPercent(usageRate).toFixed(2))
}

export function getDiskUsage() {
  const rootPath = path.parse(process.cwd()).root || process.cwd()
  const stats = fs.statfsSync(rootPath)
  const total = stats.blocks * stats.bsize
  const available = stats.bavail * stats.bsize
  const used = total - available
  return {
    totalGb: toGb(total),
    usedGb: toGb(used),
    freeGb: toGb(available),
  }
}

/** 采集当前宿主机 CPU / 内存 / 磁盘快照（node 与 system 模块共用） */
export function collectHostResourceSnapshot(): HostResourceSnapshot {
  const cpuUsageRate = getCpuUsageRate()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const memoryUsageRate = totalMem > 0
    ? Number(clampPercent((usedMem / totalMem) * 100).toFixed(2))
    : 0
  const disk = getDiskUsage()
  const diskUsageRate = disk.totalGb > 0
    ? Number(clampPercent((disk.usedGb / disk.totalGb) * 100).toFixed(2))
    : 0

  return {
    cpu: {
      cores: Math.max(1, os.cpus().length),
      usageRate: cpuUsageRate,
      availableRate: Number((100 - cpuUsageRate).toFixed(2)),
    },
    memory: {
      totalGb: toGb(totalMem),
      usedGb: toGb(usedMem),
      freeGb: toGb(freeMem),
      usageRate: memoryUsageRate,
    },
    disk: {
      totalGb: disk.totalGb,
      usedGb: disk.usedGb,
      freeGb: disk.freeGb,
      usageRate: diskUsageRate,
    },
  }
}
