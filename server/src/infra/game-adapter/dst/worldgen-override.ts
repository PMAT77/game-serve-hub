import type {
  CavesWorldgenPreset,
  MasterWorldgenPreset,
  ShardId,
  ShardWorldgenPreset,
} from '../../../../../shared/contracts/shard'

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

export function parseWorldgenOverride(content: string): { preset: string | null, warnings: string[] } {
  const warnings: string[] = []
  const presetMatch = content.match(/preset\s*=\s*["']([^"']+)["']/)
  if (!presetMatch) {
    warnings.push('worldgenoverride.lua 中未识别 preset，将使用默认预设')
    return { preset: null, warnings }
  }
  return { preset: presetMatch[1]!.trim(), warnings }
}

export function buildWorldgenOverride(preset: ShardWorldgenPreset): string {
  return [
    'return {',
    '  override_enabled = true,',
    `  preset = "${preset}",`,
    '  overrides = {},',
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
