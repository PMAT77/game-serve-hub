import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { findUserByToken, listServerNodes, saveServerNode } from '../../shared/db/index'
import { success, unauthorized } from '../../shared/http/response'

interface LocalNodeResourceSnapshot {
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

interface NodeViewItem {
  id: string
  name: string
  host: string
  sshPort: number
  status: 'online' | 'offline'
  resources: LocalNodeResourceSnapshot
  lastHeartbeatAt: string | null
  createdAt: string
  updatedAt: string
}

const LOCAL_NODE_ID = 'local-node'
let previousCpuTotal = 0
let previousCpuIdle = 0

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return tokenHeader ?? ''
}

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const token = normalizeToken(request.headers.token)
  if (!token) {
    return undefined
  }
  return token
}

async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  const token = getTokenByRequest(request)
  if (!token) {
    return unauthorized(request)
  }
  const user = await findUserByToken(token)
  if (!user) {
    return unauthorized(request)
  }
}

function toGb(value: number) {
  return Number((value / 1024 / 1024 / 1024).toFixed(2))
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

function getCpuUsageRate() {
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

function getDiskUsage() {
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

function collectLocalNodeSnapshot(): LocalNodeResourceSnapshot {
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

async function upsertLocalNode() {
  const now = new Date().toISOString()
  const snapshot = collectLocalNodeSnapshot()
  const saved = await saveServerNode({
    id: LOCAL_NODE_ID,
    name: '本地节点',
    host: os.hostname(),
    status: 'online',
    cpuUsage: snapshot.cpu.usageRate,
    memoryUsage: snapshot.memory.usageRate,
    diskUsage: snapshot.disk.usageRate,
    lastHeartbeatAt: now,
  })
  return {
    id: saved.id,
    name: saved.name,
    host: saved.host,
    sshPort: saved.sshPort,
    status: saved.status,
    resources: snapshot,
    lastHeartbeatAt: saved.lastHeartbeatAt,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  } satisfies NodeViewItem
}

function toNodeViewItem(item: Awaited<ReturnType<typeof listServerNodes>>[number]): NodeViewItem {
  return {
    id: item.id,
    name: item.name,
    host: item.host,
    sshPort: item.sshPort,
    status: item.status,
    resources: {
      cpu: {
        cores: Math.max(1, os.cpus().length),
        usageRate: Number(item.cpuUsage.toFixed(2)),
        availableRate: Number((100 - item.cpuUsage).toFixed(2)),
      },
      memory: {
        totalGb: 0,
        usedGb: 0,
        freeGb: 0,
        usageRate: Number(item.memoryUsage.toFixed(2)),
      },
      disk: {
        totalGb: 0,
        usedGb: 0,
        freeGb: 0,
        usageRate: Number(item.diskUsage.toFixed(2)),
      },
    },
    lastHeartbeatAt: item.lastHeartbeatAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

/**
 * node 模块注册入口
 * 负责本地节点注册、资源探测与节点列表读取。
 */
export function registerNodeModule(app: FastifyInstance) {
  app.addHook('onReady', async () => {
    await upsertLocalNode()
  })

  app.post('/app/node/local/register', async (request): Promise<ApiSuccessResponse<NodeViewItem> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    return success(await upsertLocalNode(), request)
  })

  app.post('/app/node/list', async (request): Promise<ApiSuccessResponse<NodeViewItem[]> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const nodes = await listServerNodes()
    const localNode = await upsertLocalNode()
    const list = nodes
      .filter(node => node.id !== LOCAL_NODE_ID)
      .map(toNodeViewItem)
    return success([localNode, ...list], request)
  })
}
