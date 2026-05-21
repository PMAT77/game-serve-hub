import fs from 'node:fs'
import type {
  CavesWorldgenPreset,
  ShardContainerStatus,
  ShardId,
  ShardInitCavesResult,
  ShardListDto,
  ShardSavePayload,
  ShardSaveResult,
  ShardSummaryDto,
  ShardWorldgenPreset,
} from '../../../../../shared/contracts/shard'
import type { DbGameInstance } from '../../../shared/db/index'
import { getContainerRuntime } from '../../container'
import { buildShardContainerName } from '../../container/naming'
import { backupFile, writeFileAtomic } from './atomic-write'
import { ensureDstCavesShardConfig } from './cluster-config'
import { parseClusterIni } from './cluster-ini'
import { resolveClusterPaths, resolveInstanceInstallPath } from './cluster-service'
import {
  findPortConflictsBetweenShards,
  parseServerIni,
  buildServerIni,
  validateServerIniFields,
  defaultMasterServerIniFields,
} from './server-ini'
import {
  isCavesShardConfigured,
  isMasterShardConfigured,
  resolveCavesServerIniPath,
  resolveMasterServerIniPath,
  isShardWorldGenerated,
  resolveShardLeveldataPath,
  resolveShardServerIniPath,
  resolveShardWorldgenPath,
} from './shard-layout'
import {
  mergeLeveldataOverrides,
  parseLeveldataOverrides,
  validateWorldRuleOverrides,
} from './leveldata-override'
import {
  buildWorldgenOverride,
  defaultWorldgenPreset,
  isValidWorldgenPreset,
  parseWorldgenOverride,
  validateWorldgenPreset,
} from './worldgen-override'
import type { ServerIniFields } from './server-ini'

const SHARD_DISPLAY: Record<ShardId, string> = {
  master: '主世界（地表）',
  caves: '洞穴（地下）',
}

function readClusterShardEnabled(clusterIniPath: string): boolean {
  if (!fs.existsSync(clusterIniPath)) {
    return false
  }
  const content = fs.readFileSync(clusterIniPath, 'utf8')
  const { fields } = parseClusterIni(content)
  return fields.shardEnabled
}

function readShardIniFields(installPath: string, shardId: ShardId): ServerIniFields | null {
  const iniPath = resolveShardServerIniPath(installPath, shardId)
  if (!fs.existsSync(iniPath)) {
    return null
  }
  const content = fs.readFileSync(iniPath, 'utf8')
  return parseServerIni(content, shardId).fields
}

function readShardLeveldataOverrides(installPath: string, shardId: ShardId): Record<string, string> | null {
  const luaPath = resolveShardLeveldataPath(installPath, shardId)
  if (!fs.existsSync(luaPath)) {
    return null
  }
  const content = fs.readFileSync(luaPath, 'utf8')
  const overrides = parseLeveldataOverrides(content)
  return Object.keys(overrides).length > 0 ? overrides : {}
}

function readShardWorldgenPreset(installPath: string, shardId: ShardId): ShardWorldgenPreset | null {
  const luaPath = resolveShardWorldgenPath(installPath, shardId)
  if (!fs.existsSync(luaPath)) {
    return null
  }
  const content = fs.readFileSync(luaPath, 'utf8')
  const { preset } = parseWorldgenOverride(content)
  if (preset && isValidWorldgenPreset(shardId, preset)) {
    return preset
  }
  return defaultWorldgenPreset(shardId)
}

export async function resolveShardContainerStatus(
  instanceId: string,
  shardId: ShardId,
): Promise<ShardContainerStatus> {
  const name = buildShardContainerName(instanceId, shardId)
  const runtime = getContainerRuntime()
  const ref = await runtime.findByName(name)
  if (!ref) {
    return 'not_created'
  }
  try {
    const inspect = await runtime.inspect(ref)
    return inspect.running ? 'running' : 'stopped'
  }
  catch {
    return 'unknown'
  }
}

function buildShardSummary(
  shardId: ShardId,
  installPath: string,
  instanceStatus: DbGameInstance['status'],
  containerStatus: ShardContainerStatus,
  clusterShardEnabled: boolean,
): ShardSummaryDto {
  const configured = shardId === 'master'
    ? isMasterShardConfigured(installPath)
    : clusterShardEnabled && isCavesShardConfigured(installPath)
  const warnings: string[] = []
  let serverPort: number | null = null
  let steamAuthPort: number | null = null
  let steamMasterPort: number | null = null
  let worldgenPreset: ShardWorldgenPreset | null = null
  let leveldataOverrides: Record<string, string> | null = null
  let worldGenerated = false
  if (shardId === 'caves' && !clusterShardEnabled) {
    warnings.push('洞穴未开启，请在房间设置中打开「启用洞穴」并保存')
  }
  else if (configured) {
    const fields = readShardIniFields(installPath, shardId)
    if (fields) {
      serverPort = fields.serverPort
      steamAuthPort = fields.steamAuthPort
      steamMasterPort = fields.steamMasterPort
    }
    worldgenPreset = readShardWorldgenPreset(installPath, shardId)
    leveldataOverrides = readShardLeveldataOverrides(installPath, shardId)
    worldGenerated = isShardWorldGenerated(installPath, shardId)
  }
  else if (shardId === 'caves' && clusterShardEnabled) {
    warnings.push('洞穴配置尚未就绪，请重新保存房间设置或启动实例')
  }
  return {
    id: shardId,
    displayName: SHARD_DISPLAY[shardId],
    configured,
    containerStatus,
    serverPort,
    steamAuthPort,
    steamMasterPort,
    worldgenPreset,
    leveldataOverrides,
    worldGenerated,
    isMaster: shardId === 'master',
    configDirty: instanceStatus === 'running',
    warnings,
  }
}

function buildEffectiveHints(
  clusterShardEnabled: boolean,
  instanceStatus: DbGameInstance['status'],
  cavesConfigured: boolean,
): string[] {
  const hints: string[] = []
  if (instanceStatus === 'running') {
    hints.push('实例运行中，世界配置变更需重启实例后生效')
  }
  if (clusterShardEnabled) {
    hints.push('公网游玩时，请在防火墙或云安全组放行地上与洞穴的游戏端口')
  }
  if (!clusterShardEnabled) {
    hints.push('洞穴未开启：请在房间设置中打开「启用洞穴」并保存')
  }
  else if (!cavesConfigured) {
    hints.push('洞穴配置尚未就绪，请重新保存房间设置或启动实例')
  }
  return hints
}

export async function getShardList(instance: DbGameInstance): Promise<ShardListDto> {
  const installPath = resolveInstanceInstallPath(instance)
  const { clusterIniPath } = resolveClusterPaths(installPath)
  const clusterShardEnabled = readClusterShardEnabled(clusterIniPath)
  const masterStatus = await resolveShardContainerStatus(instance.id, 'master')
  const cavesStatus = await resolveShardContainerStatus(instance.id, 'caves')
  const warnings: string[] = []
  if (clusterShardEnabled && !isCavesShardConfigured(installPath)) {
    warnings.push('房间已开启洞穴，但配置尚未就绪，请重新保存房间设置或启动实例')
  }
  if (!clusterShardEnabled) {
    warnings.push('洞穴已关闭：配置文件仍保留，启动时不会运行洞穴服务器')
  }
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    instanceStatus: instance.status,
    clusterShardEnabled,
    shards: [
      buildShardSummary('master', installPath, instance.status, masterStatus, clusterShardEnabled),
      buildShardSummary('caves', installPath, instance.status, cavesStatus, clusterShardEnabled),
    ],
    effectiveHints: buildEffectiveHints(
      clusterShardEnabled,
      instance.status,
      isCavesShardConfigured(installPath),
    ),
    warnings,
  }
}

export function initCavesShard(instance: DbGameInstance, masterGamePort?: number | null): ShardInitCavesResult {
  const installPath = resolveInstanceInstallPath(instance)
  const gamePort = masterGamePort ?? instance.gamePort ?? undefined
  const result = ensureDstCavesShardConfig(installPath, gamePort ?? undefined)
  return {
    initialized: true,
    alreadyConfigured: !result.created,
    serverPort: result.serverPort,
    steamAuthPort: result.steamAuthPort,
    steamMasterPort: result.steamMasterPort,
    worldgenPreset: defaultWorldgenPreset('caves') as CavesWorldgenPreset,
  }
}

export function saveShardConfig(instance: DbGameInstance, payload: ShardSavePayload): ShardSaveResult {
  const installPath = resolveInstanceInstallPath(instance)
  const shardId = payload.shard
  const { clusterIniPath } = resolveClusterPaths(installPath)
  const clusterShardEnabled = readClusterShardEnabled(clusterIniPath)
  if (shardId === 'caves') {
    if (!clusterShardEnabled) {
      throw new Error('洞穴未开启，请先在房间设置中打开「启用洞穴」并保存')
    }
    if (!isCavesShardConfigured(installPath)) {
      ensureDstCavesShardConfig(installPath, instance.gamePort ?? undefined)
    }
  }
  const presetError = validateWorldgenPreset(shardId, payload.worldgenPreset)
  if (presetError) {
    throw new Error(presetError)
  }
  const fields: ServerIniFields = {
    isMaster: shardId === 'master',
    shardName: shardId === 'master' ? 'Master' : 'Caves',
    serverPort: payload.serverPort,
    steamAuthPort: payload.steamAuthPort,
    steamMasterPort: payload.steamMasterPort,
  }
  const fieldErrors = validateServerIniFields(fields, shardId)
  if (fieldErrors.length > 0) {
    throw new Error(fieldErrors.join('；'))
  }
  const masterFields = readShardIniFields(installPath, 'master')
  const cavesFields = shardId === 'caves' ? fields : readShardIniFields(installPath, 'caves')
  const otherMaster = shardId === 'master' ? fields : masterFields
  const otherCaves = shardId === 'caves' ? fields : cavesFields
  if (otherMaster && otherCaves) {
    const crossErrors = findPortConflictsBetweenShards(otherMaster, otherCaves)
    if (crossErrors.length > 0) {
      throw new Error(crossErrors.join('；'))
    }
  }
  if (isShardWorldGenerated(installPath, shardId)) {
    const currentPreset = readShardWorldgenPreset(installPath, shardId)
    if (currentPreset && currentPreset !== payload.worldgenPreset) {
      throw new Error('该分片世界已生成，无法修改世界生成预设')
    }
  }
  const iniPath = resolveShardServerIniPath(installPath, shardId)
  const worldgenPath = resolveShardWorldgenPath(installPath, shardId)
  const leveldataPath = resolveShardLeveldataPath(installPath, shardId)
  backupFile(iniPath)
  if (!isShardWorldGenerated(installPath, shardId)) {
    backupFile(worldgenPath)
    writeFileAtomic(worldgenPath, buildWorldgenOverride(payload.worldgenPreset))
  }
  writeFileAtomic(iniPath, buildServerIni(fields))
  const leveldataPatch: Record<string, string> = {}
  if (payload.worldRuleOverrides) {
    Object.assign(leveldataPatch, payload.worldRuleOverrides)
  }
  if (payload.worldgenOverrides) {
    if (isShardWorldGenerated(installPath, shardId)) {
      throw new Error('该分片世界已生成，无法修改地图生成详细参数')
    }
    Object.assign(leveldataPatch, payload.worldgenOverrides)
  }
  if (Object.keys(leveldataPatch).length > 0) {
    const patchError = validateWorldRuleOverrides(leveldataPatch)
    if (patchError) {
      throw new Error(patchError)
    }
    if (fs.existsSync(leveldataPath)) {
      backupFile(leveldataPath)
    }
    const existing = fs.existsSync(leveldataPath)
      ? fs.readFileSync(leveldataPath, 'utf8')
      : null
    writeFileAtomic(
      leveldataPath,
      mergeLeveldataOverrides(existing, leveldataPatch, shardId),
    )
  }
  return { saved: true, restarted: false }
}

export function readClusterShardEnabledFromInstall(installPath: string): boolean {
  const { clusterIniPath } = resolveClusterPaths(installPath)
  return readClusterShardEnabled(clusterIniPath)
}

export function readMasterServerIniFields(installPath: string, gamePort?: number | null): ServerIniFields {
  const existing = readShardIniFields(installPath, 'master')
  if (existing) {
    return existing
  }
  return defaultMasterServerIniFields(gamePort ?? undefined)
}

export function readCavesServerIniFields(installPath: string): ServerIniFields | null {
  return readShardIniFields(installPath, 'caves')
}

export { resolveMasterServerIniPath, resolveCavesServerIniPath, isCavesShardConfigured }
