import path from 'node:path'
import type { ShardContainerSpec } from '../../container/types'
import { buildMasterContainerName } from '../../container/naming'
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

export function buildDstMasterShardContainerSpec(input: {
  instanceId: string
  hostInstallPath: string
  image: string
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
  const gamePort = input.clusterInput.gamePort ?? DST_DEFAULT_GAME_PORT
  return {
    instanceId: input.instanceId,
    shard: 'master',
    image: input.image,
    name: buildMasterContainerName(input.instanceId),
    hostInstallPath: input.hostInstallPath,
    containerGameRoot,
    cmd: [executable, ...buildDstLaunchArgs(containerStorageRoot)],
    workingDir,
    ports: [
      {
        hostPort: gamePort,
        containerPort: gamePort,
        protocol: 'udp',
      },
    ],
  }
}
