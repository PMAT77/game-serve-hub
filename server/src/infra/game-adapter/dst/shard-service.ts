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
  migrateLegacyLeveldataOverride,
  parseLeveldataOverrides,
} from './leveldata-override'
import { validateWorldRuleOverrides } from './lua-overrides'
import {
  buildWorldgenOverride,
  defaultWorldgenPreset,
  isValidWorldgenPreset,
  parseWorldgenOverride,
  validateWorldgenPreset,
} from './worldgen-override'
import {
  isPanelMasterWorldSaved,
  markPanelMasterWorldSaved,
  readPanelConfigMeta,
} from './panel-config-meta'
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

/**
 * 已保存的世界配置覆盖项。
 * 真源是 worldgenoverride.lua（面板写入预设 + 全部覆盖项）；为空时回退读历史
 * leveldataoverride.lua，保证升级后的面板显示不倒退（迁移在启动/保存时执行）。
 */
function readShardSavedOverrides(installPath: string, shardId: ShardId): Record<string, string> | null {
  const worldgenPath = resolveShardWorldgenPath(installPath, shardId)
  if (fs.existsSync(worldgenPath)) {
    const content = fs.readFileSync(worldgenPath, 'utf8')
    const { overrides } = parseWorldgenOverride(content)
    if (Object.keys(overrides).length > 0) {
      return overrides
    }
  }
  const legacyPath = resolveShardLeveldataPath(installPath, shardId)
  if (fs.existsSync(legacyPath)) {
    return parseLeveldataOverrides(fs.readFileSync(legacyPath, 'utf8'))
  }
  return fs.existsSync(worldgenPath) ? {} : null
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
  panelMeta: ReturnType<typeof readPanelConfigMeta>,
): ShardSummaryDto {
  const configured = shardId === 'master'
    ? isMasterShardConfigured(installPath)
    : clusterShardEnabled && isCavesShardConfigured(installPath)
  let serverPort: number | null = null
  let steamAuthPort: number | null = null
  let steamMasterPort: number | null = null
  let worldgenPreset: ShardWorldgenPreset | null = null
  let savedOverrides: Record<string, string> | null = null
  let worldGenerated = false
  if (configured) {
    const fields = readShardIniFields(installPath, shardId)
    if (fields) {
      serverPort = fields.serverPort
      steamAuthPort = fields.steamAuthPort
      steamMasterPort = fields.steamMasterPort
    }
    worldgenPreset = readShardWorldgenPreset(installPath, shardId)
    savedOverrides = readShardSavedOverrides(installPath, shardId)
    worldGenerated = isShardWorldGenerated(installPath, shardId)
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
    overrides: savedOverrides,
    worldGenerated,
    isMaster: shardId === 'master',
    panelSaved: shardId === 'master' && isPanelMasterWorldSaved(panelMeta),
    configDirty: instanceStatus === 'running',
  }
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
  const panelMeta = readPanelConfigMeta(installPath)
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    instanceStatus: instance.status,
    clusterShardEnabled,
    shards: [
      buildShardSummary('master', installPath, instance.status, masterStatus, clusterShardEnabled, panelMeta),
      buildShardSummary('caves', installPath, instance.status, cavesStatus, clusterShardEnabled, panelMeta),
    ],
    // 恒为空：面向用户的说明已内联到页面（世界规则/世界生成/网络页签与洞穴开关卡片）。
    effectiveHints: [],
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
  const overridePatch: Record<string, string> = {}
  if (payload.worldRuleOverrides) {
    Object.assign(overridePatch, payload.worldRuleOverrides)
  }
  if (payload.worldgenOverrides) {
    if (isShardWorldGenerated(installPath, shardId)) {
      throw new Error('该分片世界已生成，无法修改地图生成详细参数')
    }
    Object.assign(overridePatch, payload.worldgenOverrides)
  }
  const patchError = validateWorldRuleOverrides(overridePatch)
  if (patchError) {
    throw new Error(patchError)
  }
  const iniPath = resolveShardServerIniPath(installPath, shardId)
  const worldgenPath = resolveShardWorldgenPath(installPath, shardId)
  backupFile(iniPath)
  writeFileAtomic(iniPath, buildServerIni(fields))
  // 历史版本把覆盖项写在 leveldataoverride.lua，DST 侧会被本文件的预设整份覆盖：
  // 先把旧文件迁移进 worldgenoverride.lua，再在其上叠加本次改动（单一真源）。
  migrateLegacyLeveldataOverride(installPath, shardId)
  const existingOverrides = readShardSavedOverrides(installPath, shardId) ?? {}
  backupFile(worldgenPath)
  writeFileAtomic(
    worldgenPath,
    buildWorldgenOverride(payload.worldgenPreset, { ...existingOverrides, ...overridePatch }),
  )
  if (shardId === 'master') {
    markPanelMasterWorldSaved(installPath)
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
