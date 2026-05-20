import fs from 'node:fs'
import path from 'node:path'
import type { ClusterConfigDto, ClusterSavePayload, ClusterSaveResult } from '../../../../../shared/contracts/cluster'
import type { DbGameInstance } from '../../../shared/db/index'
import { getServerContainerConfig } from '../../../shared/config/container'
import { DST_CLUSTER_NAME, DST_CONF_DIR, DST_STORAGE_DIR } from './constants'
import { backupFile, writeFileAtomic } from './atomic-write'
import {
  buildClusterIni,
  defaultClusterIniFields,
  parseClusterIni,
  payloadToIniFields,
  validateClusterFields,
} from './cluster-ini'
import {
  maskClusterToken,
  readClusterTokenFile,
  validateClusterToken,
  writeClusterTokenFile,
} from './cluster-token'
import {
  isCavesShardConfigured,
  SHARD_ENABLE_BLOCKED_MESSAGE,
} from './shard-layout'

export interface ClusterPaths {
  clusterRoot: string
  clusterIniPath: string
  clusterTokenPath: string
}

export function resolveClusterPaths(installPath: string): ClusterPaths {
  const clusterRoot = path.join(installPath, DST_STORAGE_DIR, DST_CONF_DIR, DST_CLUSTER_NAME)
  return {
    clusterRoot,
    clusterIniPath: path.join(clusterRoot, 'cluster.ini'),
    clusterTokenPath: path.join(clusterRoot, 'cluster_token.txt'),
  }
}

/** 与实例启动逻辑一致：DB 无 installPath 时回退到 instancesRoot/{instanceId} */
export function resolveInstanceInstallPath(instance: Pick<DbGameInstance, 'id' | 'installPath'>): string {
  const fromDb = instance.installPath?.trim()
  if (fromDb) {
    return fromDb
  }
  const { instancesRoot } = getServerContainerConfig()
  return path.join(instancesRoot, instance.id)
}

export function ensureClusterDirectory(installPath: string): void {
  const { clusterRoot } = resolveClusterPaths(installPath)
  fs.mkdirSync(clusterRoot, { recursive: true })
}

function buildEffectiveHints(
  networkMode: ClusterConfigDto['networkMode'],
  instanceStatus: DbGameInstance['status'],
  shardEnabled: boolean,
): string[] {
  const hints: string[] = []
  if (instanceStatus === 'running') {
    hints.push('实例运行中，配置变更需重启实例后生效')
  }
  if (shardEnabled) {
    hints.push('已启用分片：主世界与洞穴需使用相同的 cluster_key 与 master_port')
  }
  if (networkMode === 'public') {
    hints.push('公网模式需确保防火墙已放行游戏端口')
  }
  if (networkMode === 'lan_only') {
    hints.push('仅局域网模式：同一局域网内玩家可发现房间')
  }
  if (networkMode === 'offline') {
    hints.push('离线模式：不向 Klei 注册，不会出现在游戏浏览列表')
  }
  return hints
}

function readClusterIniFields(clusterIniPath: string, instanceName: string) {
  if (!fs.existsSync(clusterIniPath)) {
    const fields = defaultClusterIniFields(instanceName)
    const content = buildClusterIni(fields)
    writeFileAtomic(clusterIniPath, content)
    return { fields, warnings: ['cluster.ini 缺失，已按默认模板重建'] as string[] }
  }
  const content = fs.readFileSync(clusterIniPath, 'utf8')
  return parseClusterIni(content)
}

export function getClusterConfig(instance: DbGameInstance): ClusterConfigDto {
  const installPath = resolveInstanceInstallPath(instance)
  if (!fs.existsSync(installPath)) {
    throw new Error('实例安装目录不存在，无法读取房间配置')
  }
  ensureClusterDirectory(installPath)

  const { clusterIniPath, clusterTokenPath } = resolveClusterPaths(installPath)
  const { fields, warnings } = readClusterIniFields(clusterIniPath, instance.name)
  const token = readClusterTokenFile(clusterTokenPath)
  const tokenConfigured = Boolean(token && !validateClusterToken(token))

  if (fields.networkMode === 'public' && !tokenConfigured) {
    warnings.push('公网模式但未配置有效的 Klei 集群令牌，请粘贴令牌或切换联网模式')
  }

  const instanceStatus = instance.status
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    instanceStatus,
    networkMode: fields.networkMode,
    clusterName: fields.clusterName,
    clusterDescription: fields.clusterDescription,
    clusterPassword: fields.clusterPassword,
    gameMode: fields.gameMode,
    maxPlayers: fields.maxPlayers,
    pvp: fields.pvp,
    pauseWhenEmpty: fields.pauseWhenEmpty,
    voteEnabled: fields.voteEnabled,
    clusterIntention: fields.clusterIntention,
    tickRate: fields.tickRate,
    maxSnapshots: fields.maxSnapshots,
    shardEnabled: fields.shardEnabled,
    bindIp: fields.bindIp,
    masterIp: fields.masterIp,
    masterPort: fields.masterPort,
    clusterKey: fields.clusterKey,
    steamGroupOnly: fields.steamGroupOnly,
    steamGroupId: fields.steamGroupId,
    steamGroupAdmins: fields.steamGroupAdmins,
    clusterTokenConfigured: tokenConfigured,
    clusterTokenMasked: tokenConfigured && token ? maskClusterToken(token) : null,
    configDirty: instanceStatus === 'running',
    effectiveHints: buildEffectiveHints(fields.networkMode, instanceStatus, fields.shardEnabled),
    warnings,
  }
}

export function saveClusterConfig(instance: DbGameInstance, payload: ClusterSavePayload): ClusterSaveResult {
  const installPath = resolveInstanceInstallPath(instance)
  if (!fs.existsSync(installPath)) {
    throw new Error('实例安装目录不存在，无法保存房间配置')
  }
  ensureClusterDirectory(installPath)

  const fields = payloadToIniFields(payload)
  const fieldErrors = validateClusterFields(fields)
  if (fieldErrors.length > 0) {
    throw new Error(fieldErrors.join('；'))
  }

  if (payload.shardEnabled && !isCavesShardConfigured(installPath)) {
    throw new Error(SHARD_ENABLE_BLOCKED_MESSAGE)
  }

  const { clusterIniPath, clusterTokenPath } = resolveClusterPaths(installPath)
  const existingToken = readClusterTokenFile(clusterTokenPath)
  const tokenConfigured = Boolean(existingToken && !validateClusterToken(existingToken))

  if (payload.networkMode === 'public') {
    const newToken = payload.clusterToken?.trim()
    if (newToken) {
      const tokenError = validateClusterToken(newToken)
      if (tokenError) {
        throw new Error(tokenError)
      }
    }
    else if (!tokenConfigured) {
      throw new Error('公网模式必须提供有效的 Klei 集群令牌')
    }
  }

  backupFile(clusterIniPath)
  writeFileAtomic(clusterIniPath, buildClusterIni(fields))

  if (payload.networkMode === 'public' && payload.clusterToken?.trim()) {
    backupFile(clusterTokenPath)
    writeClusterTokenFile(clusterTokenPath, payload.clusterToken)
  }

  return {
    saved: true,
    restarted: false,
  }
}
