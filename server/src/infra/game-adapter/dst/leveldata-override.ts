import fs from 'node:fs'
import type { ShardId, ShardWorldgenPreset } from '../../../../../shared/contracts/shard'
import { parseOverridesBlock } from './lua-overrides'
import { backupFile, writeFileAtomic } from './atomic-write'
import {
  isCavesShardConfigured,
  resolveShardLeveldataPath,
  resolveShardWorldgenPath,
} from './shard-layout'
import {
  buildWorldgenOverride,
  defaultWorldgenPreset,
  isValidWorldgenPreset,
  parseWorldgenOverride,
} from './worldgen-override'

/**
 * 历史版本的 leveldataoverride.lua：面板曾把世界规则写在这里。
 * 该文件在 DST 侧会被 worldgenoverride.lua 的预设整份覆盖（见 worldgen-override.ts 注释），
 * 现已不再写入，只保留解析入口供迁移与历史数据读取使用。
 */
export function parseLeveldataOverrides(content: string): Record<string, string> {
  return parseOverridesBlock(content)
}

function resolveDeclaredPreset(content: string): string | null {
  const settingsId = content.match(/settings_id\s*=\s*["']([^"']+)["']/)?.[1]
  const id = content.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1]
  return settingsId?.trim() || id?.trim() || null
}

/** 迁移时的预设：已有 worldgenoverride 的预设优先，其次 leveldata 自带的预设标识，最后分片默认 */
function resolveMigrationPreset(
  shardId: ShardId,
  worldgenContent: string,
  leveldataContent: string,
): ShardWorldgenPreset {
  if (worldgenContent.trim()) {
    const { preset } = parseWorldgenOverride(worldgenContent)
    if (preset && isValidWorldgenPreset(shardId, preset)) {
      return preset
    }
  }
  const declared = resolveDeclaredPreset(leveldataContent)
  if (declared && isValidWorldgenPreset(shardId, declared)) {
    return declared
  }
  return defaultWorldgenPreset(shardId)
}

/**
 * 把历史 leveldataoverride.lua 里的覆盖项搬进 worldgenoverride.lua 并删除旧文件。
 *
 * - 旧的 leveldata 只带覆盖项，没有预设，因此合并时保留 worldgen 文件已有的值；
 * - 删除旧文件前先备份（\`.bak.<时间戳>\`）；
 * - 幂等：文件不存在时什么都不做。
 */
export function migrateLegacyLeveldataOverride(installPath: string, shardId: ShardId): boolean {
  const leveldataPath = resolveShardLeveldataPath(installPath, shardId)
  if (!fs.existsSync(leveldataPath)) {
    return false
  }
  const leveldataContent = fs.readFileSync(leveldataPath, 'utf8')
  const worldgenPath = resolveShardWorldgenPath(installPath, shardId)
  const worldgenContent = fs.existsSync(worldgenPath)
    ? fs.readFileSync(worldgenPath, 'utf8')
    : ''
  const preset = resolveMigrationPreset(shardId, worldgenContent, leveldataContent)
  const merged: Record<string, string> = {
    ...parseLeveldataOverrides(leveldataContent),
    ...(worldgenContent ? parseWorldgenOverride(worldgenContent).overrides : {}),
  }
  backupFile(leveldataPath)
  backupFile(worldgenPath)
  writeFileAtomic(worldgenPath, buildWorldgenOverride(preset, merged))
  fs.rmSync(leveldataPath, { force: true })
  return true
}

/** 迁移全部已配置分片，返回迁移数量 */
export function migrateLegacyLeveldataOverrides(installPath: string): number {
  let migrated = 0
  if (migrateLegacyLeveldataOverride(installPath, 'master')) {
    migrated++
  }
  if (isCavesShardConfigured(installPath) && migrateLegacyLeveldataOverride(installPath, 'caves')) {
    migrated++
  }
  return migrated
}
