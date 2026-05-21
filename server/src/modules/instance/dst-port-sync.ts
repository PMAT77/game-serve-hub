import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { findHostUdpPortConflicts, formatPortConflictMessage } from '../../infra/game-adapter/dst/port-conflict'
import {
  allocateDstGamePort,
  applyDstPortBlockToInstall,
  collectReservedDstPortsOnNode,
  findPortOverlapWithReserved,
} from '../../infra/game-adapter/dst/port-allocation'
import { collectPortSet } from '../../infra/game-adapter/dst/server-ini'
import { isCavesShardConfigured } from '../../infra/game-adapter/dst/shard-layout'
import {
  defaultCavesServerIniFields,
  defaultMasterServerIniFields,
} from '../../infra/game-adapter/dst/server-ini'
import {
  readCavesServerIniFields,
  readMasterServerIniFields,
} from '../../infra/game-adapter/dst/shard-service'
import { updateGameInstanceRuntime } from '../../shared/db/index'

export interface DstPortConflictProbe {
  hasConflict: boolean
  conflictingPorts: number[]
  suggestedGamePort: number | null
  currentGamePort: number
  userMessage: string
}

function buildDstPortConflictMessage(conflictingPorts: number[], suggestedGamePort: number | null): string {
  const portList = conflictingPorts.sort((a, b) => a - b).join('、')
  const suggest = suggestedGamePort != null
    ? `系统可为您自动分配一组未占用端口（建议主世界游戏端口 ${suggestedGamePort}）。`
    : '系统可为您自动分配一组未占用端口。'
  return `无法启动：端口 ${portList} 已被同节点上运行中的其他实例占用。您可前往「世界设置 → 网络」自行修改，或选择由系统自动分配。${suggest}`
}

export async function probeDstPortConflictForStart(input: {
  instanceId: string
  nodeId: string
  gameCode: string
  installPath: string
  gamePort: number | null
}): Promise<DstPortConflictProbe> {
  const master = readMasterServerIniFields(input.installPath, input.gamePort)
  const currentGamePort = master.serverPort
  if (input.gameCode.trim() !== DST_APP_ID) {
    return {
      hasConflict: false,
      conflictingPorts: [],
      suggestedGamePort: null,
      currentGamePort,
      userMessage: '',
    }
  }
  const reserved = await collectReservedDstPortsOnNode(input.nodeId, input.instanceId, {
    onlyRunning: true,
  })
  const caves = isCavesShardConfigured(input.installPath)
    ? (readCavesServerIniFields(input.installPath) ?? defaultCavesServerIniFields(master))
    : null
  const overlap = findPortOverlapWithReserved(master, caves, reserved)
  const portsToProbe = collectPortSet(master)
  if (caves) {
    portsToProbe.push(...collectPortSet(caves))
  }
  const hostConflicts = await findHostUdpPortConflicts([...new Set(portsToProbe)])
  const conflictingPorts = [...new Set([...overlap, ...hostConflicts])]
  if (conflictingPorts.length === 0) {
    return {
      hasConflict: false,
      conflictingPorts: [],
      suggestedGamePort: null,
      currentGamePort,
      userMessage: '',
    }
  }
  let suggestedGamePort: number | null = null
  try {
    suggestedGamePort = await allocateDstGamePort(input.nodeId, input.instanceId)
  }
  catch {
    suggestedGamePort = null
  }
  const userMessage = overlap.length > 0
    ? buildDstPortConflictMessage(conflictingPorts, suggestedGamePort)
    : `无法启动：${formatPortConflictMessage(hostConflicts)}`
  return {
    hasConflict: true,
    conflictingPorts,
    suggestedGamePort,
    currentGamePort,
    userMessage,
  }
}

export async function applyDstPortAutoAllocate(input: {
  instanceId: string
  nodeId: string
  installPath: string
  gamePort: number | null
  suggestedGamePort?: number | null
}): Promise<{ ok: true, gamePort: number } | { ok: false, message: string }> {
  let gamePort = input.suggestedGamePort ?? null
  try {
    if (gamePort == null) {
      gamePort = await allocateDstGamePort(input.nodeId, input.instanceId)
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '无法分配游戏端口'
    return { ok: false, message }
  }
  applyDstPortBlockToInstall(input.installPath, gamePort)
  if (gamePort !== input.gamePort) {
    await updateGameInstanceRuntime(input.instanceId, { gamePort })
  }
  return { ok: true, gamePort }
}

/** 启动前解析 gamePort：冲突时须 autoAllocatePorts；无冲突且未设端口时静默分配 */
export async function resolveDstGamePortForStart(input: {
  instanceId: string
  nodeId: string
  gameCode: string
  installPath: string
  gamePort: number | null
  autoAllocatePorts?: boolean
}): Promise<
  | { ok: true, gamePort: number }
  | { ok: false, kind: 'port_conflict', probe: DstPortConflictProbe }
  | { ok: false, kind: 'alloc_failed', message: string }
> {
  if (input.gameCode.trim() !== DST_APP_ID) {
    return { ok: true, gamePort: input.gamePort ?? 10999 }
  }
  const probe = await probeDstPortConflictForStart(input)
  if (probe.hasConflict) {
    if (!input.autoAllocatePorts) {
      return { ok: false, kind: 'port_conflict', probe }
    }
    const applied = await applyDstPortAutoAllocate({
      instanceId: input.instanceId,
      nodeId: input.nodeId,
      installPath: input.installPath,
      gamePort: input.gamePort,
      suggestedGamePort: probe.suggestedGamePort,
    })
    if (!applied.ok) {
      return { ok: false, kind: 'alloc_failed', message: applied.message }
    }
    return { ok: true, gamePort: applied.gamePort }
  }
  if (!input.gamePort) {
    const gamePort = probe.currentGamePort
    applyDstPortBlockToInstall(input.installPath, gamePort)
    await updateGameInstanceRuntime(input.instanceId, { gamePort })
    return { ok: true, gamePort }
  }
  return { ok: true, gamePort: input.gamePort }
}
