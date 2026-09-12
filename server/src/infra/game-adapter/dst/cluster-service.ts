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
import { ensureDstCavesShardConfig } from './cluster-config'
import { isCavesShardConfigured } from './shard-layout'
import {
  isPanelRoomSaved,
  markPanelRoomSaved,
  readPanelConfigMeta,
} from './panel-config-meta'

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

function readClusterIniFields(clusterIniPath: string, instanceName: string) {
  if (!fs.existsSync(clusterIniPath)) {
    const fields = defaultClusterIniFields(instanceName)
    const content = buildClusterIni(fields)
    writeFileAtomic(clusterIniPath, content)
    return { fields, warnings: [] }
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
  if (fields.shardEnabled && !isCavesShardConfigured(installPath)) {
    warnings.push('洞穴配置尚未就绪，请重新保存房间设置或启动实例')
  }

  const instanceStatus = instance.status
  const panelMeta = readPanelConfigMeta(installPath)
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
    panelRoomSaved: isPanelRoomSaved(panelMeta),
    configDirty: instanceStatus === 'running',
    // 恒为空：面向用户的说明已内联到页面（联网模式说明、洞穴卡片与世界设置入口）。
    effectiveHints: [],
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

  if (payload.shardEnabled) {
    ensureDstCavesShardConfig(installPath, instance.gamePort ?? undefined)
  }

  markPanelRoomSaved(installPath)

  return {
    saved: true,
    restarted: false,
  }
}
