import type { CavesWorldgenPreset, MasterWorldgenPreset } from '@/api/modules/shard'

export type DstShardScope = 'master' | 'caves' | 'both'

export type DstWorldOptionKind = 'worldgen' | 'rule'

export interface DstWorldOption {
  /** 与 `src/assets/images/dst/{id}.webp` 文件名一致 */
  id: string
  label: string
  image: string
  shard: DstShardScope
  kind: DstWorldOptionKind
  preset?: MasterWorldgenPreset | CavesWorldgenPreset
  ruleKey?: string
}

const ruleImageModules = import.meta.glob<string>(
  '@/assets/images/dst/*.webp',
  { eager: true, import: 'default' },
)

const CAVES_RULE_ID_PATTERN = /cave|depths|darkness|earthquake|bat_cave|bunnyman|dart_trap|moleworm|bioluminescence|ancient_gateway|ancient_spirit|enlightenment/

function parseRuleFilename(filePath: string, imageUrl: string): DstWorldOption {
  const filename = filePath.split('/').pop() ?? filePath
  const id = filename.replace(/\.webp$/i, '')
  const cavesThemed = CAVES_RULE_ID_PATTERN.test(id)
  return {
    id,
    label: id,
    image: imageUrl,
    shard: cavesThemed ? 'caves' : 'master',
    kind: 'rule',
    ruleKey: id,
  }
}

const allRuleOptions: DstWorldOption[] = Object.entries(ruleImageModules)
  .map(([path, url]) => parseRuleFilename(path, url))
  .sort((a, b) => a.id.localeCompare(b.id))

function findRuleImageById(id: string): string | undefined {
  return allRuleOptions.find(o => o.id === id)?.image
}

const WORLDGEN_IMAGE_FALLBACK: Record<string, string> = {
  SURVIVAL_TOGETHER: findRuleImageById('biomes') ?? '',
  DST_CAVE: findRuleImageById('cave_fern') ?? '',
  DST_CAVE_PLUS: findRuleImageById('cave_banana_tree') ?? '',
  COMPLETE_DARKNESS: findRuleImageById('darkness_damage') ?? '',
}

const worldgenOptions: DstWorldOption[] = [
  {
    id: 'survival_together',
    label: '联机生存',
    image: WORLDGEN_IMAGE_FALLBACK.SURVIVAL_TOGETHER,
    shard: 'master',
    kind: 'worldgen',
    preset: 'SURVIVAL_TOGETHER',
  },
  {
    id: 'dst_cave',
    label: '标准洞穴',
    image: WORLDGEN_IMAGE_FALLBACK.DST_CAVE,
    shard: 'caves',
    kind: 'worldgen',
    preset: 'DST_CAVE',
  },
  {
    id: 'dst_cave_plus',
    label: '资源丰富',
    image: WORLDGEN_IMAGE_FALLBACK.DST_CAVE_PLUS,
    shard: 'caves',
    kind: 'worldgen',
    preset: 'DST_CAVE_PLUS',
  },
  {
    id: 'complete_darkness',
    label: '完全黑暗',
    image: WORLDGEN_IMAGE_FALLBACK.COMPLETE_DARKNESS,
    shard: 'caves',
    kind: 'worldgen',
    preset: 'COMPLETE_DARKNESS',
  },
]

function matchesShard(option: DstWorldOption, shard: 'master' | 'caves'): boolean {
  return option.shard === shard || option.shard === 'both'
}

export function getWorldgenOptions(shard: 'master' | 'caves'): DstWorldOption[] {
  return worldgenOptions.filter(o => o.kind === 'worldgen' && matchesShard(o, shard))
}

/** v1：地上与洞穴共用完整规则图标列表（overrides 尚未分片持久化） */
export function getWorldRuleOptionsForShard(_shard: 'master' | 'caves'): DstWorldOption[] {
  return allRuleOptions
}

export { allRuleOptions, worldgenOptions }
