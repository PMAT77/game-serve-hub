import fs from 'node:fs'
import path from 'node:path'
import type { PortMapping, ShardContainerSpec } from '../../container/types'
import { buildCavesContainerName, buildMasterContainerName } from '../../container/naming'
import {
  DST_CONTAINER_GAME_ROOT,
  DST_DEFAULT_GAME_PORT,
  DST_STORAGE_DIR,
} from './constants'
import {
  buildDstLaunchArgs,
  ensureDstClusterConfig,
  findDstServerBinary,
  type EnsureDstClusterInput,
} from './cluster-config'
import { parseServerIni, defaultMasterServerIniFields, type ServerIniFields } from './server-ini'
import { resolveShardServerIniPath } from './shard-layout'
import type { ShardId } from '../../../../../shared/contracts/shard'

function readShardPortsFromDisk(hostInstallPath: string, shardId: ShardId, fallbackGamePort: number): ServerIniFields {
  const iniPath = resolveShardServerIniPath(hostInstallPath, shardId)
  if (fs.existsSync(iniPath)) {
    const content = fs.readFileSync(iniPath, 'utf8')
    const { fields } = parseServerIni(content, shardId)
    return fields
  }
  if (shardId === 'master') {
    return defaultMasterServerIniFields(fallbackGamePort)
  }
  const master = readShardPortsFromDisk(hostInstallPath, 'master', fallbackGamePort)
  return {
    isMaster: false,
    shardName: 'Caves',
    serverPort: master.serverPort + 1,
    steamAuthPort: master.steamAuthPort + 2,
    steamMasterPort: master.steamMasterPort + 2,
  }
}

function buildPortMappings(fields: { serverPort: number, steamAuthPort: number, steamMasterPort: number }): PortMapping[] {
  const ports = [
    { hostPort: fields.serverPort, containerPort: fields.serverPort, protocol: 'udp' as const },
    { hostPort: fields.steamAuthPort, containerPort: fields.steamAuthPort, protocol: 'udp' as const },
    { hostPort: fields.steamMasterPort, containerPort: fields.steamMasterPort, protocol: 'udp' as const },
  ]
  const seen = new Set<number>()
  return ports.filter((p) => {
    if (seen.has(p.hostPort)) {
      return false
    }
    seen.add(p.hostPort)
    return true
  })
}

function buildDstShardContainerSpec(input: {
  instanceId: string
  hostInstallPath: string
  image: string
  shardId: ShardId
  shardFolder: 'Master' | 'Caves'
  clusterInput: EnsureDstClusterInput
  containerGameRoot?: string
}): ShardContainerSpec | undefined {
  const binary = findDstServerBinary(input.hostInstallPath)
  if (!binary) {
    return undefined
  }
  ensureDstClusterConfig(input.hostInstallPath, input.clusterInput)
  const containerGameRoot = input.containerGameRoot ?? DST_CONTAINER_GAME_ROOT
  const containerStorageRoot = path.posix.join(containerGameRoot, DST_STORAGE_DIR)
  const executable = path.posix.join(containerGameRoot, binary.binDir, binary.executable)
  const workingDir = path.posix.join(containerGameRoot, binary.binDir)
  const fallbackGamePort = input.clusterInput.gamePort ?? DST_DEFAULT_GAME_PORT
  const fields = readShardPortsFromDisk(input.hostInstallPath, input.shardId, fallbackGamePort)
  const name = input.shardId === 'master'
    ? buildMasterContainerName(input.instanceId)
    : buildCavesContainerName(input.instanceId)
  return {
    instanceId: input.instanceId,
    shard: input.shardId,
    image: input.image,
    name,
    hostInstallPath: input.hostInstallPath,
    containerGameRoot,
    cmd: [executable, ...buildDstLaunchArgs(containerStorageRoot, input.shardFolder)],
    workingDir,
    ports: buildPortMappings(fields),
  }
}

export function buildDstMasterShardContainerSpec(input: {
  instanceId: string
  hostInstallPath: string
  image: string
  clusterInput: EnsureDstClusterInput
  containerGameRoot?: string
}): ShardContainerSpec | undefined {
  return buildDstShardContainerSpec({
    ...input,
    shardId: 'master',
    shardFolder: 'Master',
  })
}

export function buildDstCavesShardContainerSpec(input: {
  instanceId: string
  hostInstallPath: string
  image: string
  clusterInput: EnsureDstClusterInput
  containerGameRoot?: string
}): ShardContainerSpec | undefined {
  return buildDstShardContainerSpec({
    ...input,
    shardId: 'caves',
    shardFolder: 'Caves',
  })
}
