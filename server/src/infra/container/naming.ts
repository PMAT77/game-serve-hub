import type { ShardRole } from './types'

export function buildShardContainerName(instanceId: string, shard: ShardRole): string {
  const safeId = instanceId.replace(/[^a-zA-Z0-9_.-]/g, '-')
  return `gsh-${safeId}-${shard}`
}

export function buildMasterContainerName(instanceId: string): string {
  return buildShardContainerName(instanceId, 'master')
}

export function buildCavesContainerName(instanceId: string): string {
  return buildShardContainerName(instanceId, 'caves')
}
