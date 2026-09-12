import type {
  CavesWorldgenPreset,
  MasterWorldgenPreset,
  ShardId,
  ShardWorldgenPreset,
} from '../../../../../shared/contracts/shard'
import { buildOverridesBlock, parseOverridesBlock } from './lua-overrides'

const MASTER_PRESETS: MasterWorldgenPreset[] = ['SURVIVAL_TOGETHER']
const CAVES_PRESETS: CavesWorldgenPreset[] = ['DST_CAVE', 'DST_CAVE_PLUS', 'COMPLETE_DARKNESS']

export function isValidWorldgenPreset(shardId: ShardId, preset: string): preset is ShardWorldgenPreset {
  if (shardId === 'master') {
    return (MASTER_PRESETS as string[]).includes(preset)
  }
  return (CAVES_PRESETS as string[]).includes(preset)
}

export function defaultWorldgenPreset(shardId: ShardId): ShardWorldgenPreset {
  return shardId === 'master' ? 'SURVIVAL_TOGETHER' : 'DST_CAVE'
}

export interface ParsedWorldgenOverride {
  preset: string | null
  overrides: Record<string, string>
  warnings: string[]
}

/** 取指定键的字符串值；`preset` 必须整词匹配，避免命中 `worldgen_preset` */
function matchPresetKey(content: string, key: string): string | null {
  const pattern = '(?:^|[^a-z_])' + key + '\\s*=\\s*["\']([^"\']+)["\']'
  const matched = content.match(new RegExp(pattern))
  return matched?.[1]?.trim() || null
}

/**
 * 解析 worldgenoverride.lua。
 * 预设键按 DST 的优先级读取：preset（同时指定 worldgen/settings 预设）→ worldgen_preset → settings_preset。
 */
export function parseWorldgenOverride(content: string): ParsedWorldgenOverride {
  const warnings: string[] = []
  const overrides = parseOverridesBlock(content)
  const preset = matchPresetKey(content, 'preset')
    ?? matchPresetKey(content, 'worldgen_preset')
    ?? matchPresetKey(content, 'settings_preset')
  if (!preset) {
    warnings.push('worldgenoverride.lua 中未识别 preset，将使用默认预设')
    return { preset: null, overrides, warnings }
  }
  return { preset, overrides, warnings }
}

/**
 * 世界生成覆盖文件内容。
 *
 * DST 的实际行为（scripts/shardindex.lua → ShardIndex:SetServerShardData）决定这个文件必须是
 * 「预设 + 全部覆盖项」的唯一真源：只要 preset 能同时解析出 worldgen 与 settings 预设，
 * DST 就会用本文件整份替换 world.options，把 leveldataoverride.lua 的结果丢弃；
 * 因此**不能**只写预设、把覆盖项留在另一个文件里。
 */
export function buildWorldgenOverride(
  preset: ShardWorldgenPreset,
  overrides: Record<string, string> = {},
): string {
  return [
    'return {',
    '  override_enabled = true,',
    '  preset = "' + preset + '",',
    buildOverridesBlock(overrides),
    '}',
    '',
  ].join('\n')
}

export function validateWorldgenPreset(shardId: ShardId, preset: string): string | null {
  if (!isValidWorldgenPreset(shardId, preset)) {
    if (shardId === 'master') {
      return '主世界 worldgen 预设无效，仅支持 SURVIVAL_TOGETHER'
    }
    return '洞穴 worldgen 预设无效，支持 DST_CAVE、DST_CAVE_PLUS、COMPLETE_DARKNESS'
  }
  return null
}

export { CAVES_PRESETS, MASTER_PRESETS }
