import fs from 'node:fs'
import { buildMasterContainerName } from '../../container/naming'
import { backupFile, writeFileAtomic } from './atomic-write'
import { buildClusterIni, parseClusterIni } from './cluster-ini'
import { resolveClusterPaths } from './cluster-service'

/** Docker 双容器分片：主世界 bind 全接口，洞穴通过主世界容器名互联。 */
export const DOCKER_SHARD_BIND_IP = '0.0.0.0'

export function resolveDockerShardMasterIp(instanceId: string): string {
  return buildMasterContainerName(instanceId)
}

export function ensureDockerShardInterconnectConfig(installPath: string, instanceId: string): boolean {
  const { clusterIniPath } = resolveClusterPaths(installPath)
  if (!fs.existsSync(clusterIniPath)) {
    return false
  }
  const content = fs.readFileSync(clusterIniPath, 'utf8')
  const { fields } = parseClusterIni(content)
  if (!fields.shardEnabled) {
    return false
  }
  const masterIp = resolveDockerShardMasterIp(instanceId)
  if (fields.bindIp === DOCKER_SHARD_BIND_IP && fields.masterIp === masterIp) {
    return false
  }
  fields.bindIp = DOCKER_SHARD_BIND_IP
  fields.masterIp = masterIp
  backupFile(clusterIniPath)
  writeFileAtomic(clusterIniPath, buildClusterIni(fields))
  return true
}
