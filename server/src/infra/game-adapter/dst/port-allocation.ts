import fs from 'node:fs'
import path from 'node:path'
import { listGameInstances } from '../../../shared/db/index'
import { DST_DEFAULT_GAME_PORT } from './constants'
import { isCavesShardConfigured, resolveCavesServerIniPath, resolveMasterServerIniPath } from './shard-layout'
import {
  buildServerIni,
  collectPortSet,
  defaultCavesServerIniFields,
  defaultMasterServerIniFields,
  parseServerIni,
  type ServerIniFields,
} from './server-ini'

/** 相邻实例端口块步进（主世界 3 端口 + 洞穴 3 端口，块间留空） */
export const DST_PORT_BLOCK_STRIDE = 5

function collectPortsFromIniFile(iniPath: string, shardId: 'master' | 'caves'): number[] {
  if (!fs.existsSync(iniPath)) {
    return []
  }
  try {
    const content = fs.readFileSync(iniPath, 'utf8')
    const { fields } = parseServerIni(content, shardId)
    return collectPortSet(fields)
  }
  catch {
    return []
  }
}

export interface CollectReservedDstPortsOptions {
  /**
   * 为 true 时仅统计运行中实例（启动前探测用）；
   * 为 false 时统计全部实例配置（新建实例分配端口块用）。
   */
  onlyRunning?: boolean
}

export function shouldReserveInstanceDstPorts(
  status: string,
  options?: CollectReservedDstPortsOptions,
): boolean {
  if (!options?.onlyRunning) {
    return true
  }
  return status === 'running'
}

/** 读取同节点其它实例已占用的 UDP 端口（来自各实例 server.ini） */
export async function collectReservedDstPortsOnNode(
  nodeId: string,
  excludeInstanceId?: string,
  options?: CollectReservedDstPortsOptions,
): Promise<Set<number>> {
  const instances = await listGameInstances({ nodeId })
  const used = new Set<number>()
  for (const instance of instances) {
    if (excludeInstanceId && instance.id === excludeInstanceId) {
      continue
    }
    if (!shouldReserveInstanceDstPorts(instance.status, options)) {
      continue
    }
    const installPath = instance.installPath?.trim()
    if (!installPath || !fs.existsSync(installPath)) {
      continue
    }
    for (const port of collectPortsFromIniFile(resolveMasterServerIniPath(installPath), 'master')) {
      used.add(port)
    }
    if (isCavesShardConfigured(installPath)) {
      for (const port of collectPortsFromIniFile(resolveCavesServerIniPath(installPath), 'caves')) {
        used.add(port)
      }
    }
  }
  return used
}

function portBlockIsFree(gamePort: number, reserved: Set<number>): boolean {
  const master = defaultMasterServerIniFields(gamePort)
  const ports = collectPortSet(master)
  const caves = defaultCavesServerIniFields(master)
  ports.push(...collectPortSet(caves))
  return ports.every(port => !reserved.has(port))
}

/** 为新建实例分配未占用的主世界游戏端口（同节点多实例必用不同端口块） */
export async function allocateDstGamePort(
  nodeId: string,
  excludeInstanceId?: string,
): Promise<number> {
  const reserved = await collectReservedDstPortsOnNode(nodeId, excludeInstanceId)
  for (let block = 0; block < 200; block++) {
    const gamePort = DST_DEFAULT_GAME_PORT + block * DST_PORT_BLOCK_STRIDE
    if (portBlockIsFree(gamePort, reserved)) {
      return gamePort
    }
  }
  throw new Error('同节点无可用 DST 端口块，请释放实例或手动指定 gamePort')
}

/** 将端口块写入 Master/Caves 的 server.ini（启动前与 DB gamePort 对齐） */
export function applyDstPortBlockToInstall(installPath: string, gamePort: number): void {
  const masterFields = defaultMasterServerIniFields(gamePort)
  const masterIniPath = resolveMasterServerIniPath(installPath)
  fs.mkdirSync(path.dirname(masterIniPath), { recursive: true })
  fs.writeFileSync(masterIniPath, buildServerIni(masterFields), 'utf8')
  if (isCavesShardConfigured(installPath)) {
    const cavesFields = defaultCavesServerIniFields(masterFields)
    const cavesIniPath = resolveCavesServerIniPath(installPath)
    fs.mkdirSync(path.dirname(cavesIniPath), { recursive: true })
    fs.writeFileSync(cavesIniPath, buildServerIni(cavesFields), 'utf8')
  }
}

export function findPortOverlapWithReserved(
  master: ServerIniFields,
  caves: ServerIniFields | null,
  reserved: Set<number>,
): number[] {
  const ports = collectPortSet(master)
  if (caves) {
    ports.push(...collectPortSet(caves))
  }
  return [...new Set(ports.filter(port => reserved.has(port)))]
}
