export type DstRuleLevelProfileId =
  | 'boolean'
  | 'scale'
  | 'season_length'
  | 'starting_season'
  | 'game_mode'
  | 'multiplier'
  | 'dst_difficulty'
  | 'dst_regrowth'
  | 'dst_season'
  | 'dst_day'
  | 'dst_event'
  | 'dst_none_default'
  | 'dst_spawnmode'
  | 'dst_ghost'
  | 'dst_toggle'
  | 'dst_resettime'
  | 'dst_specialevent'
  | 'dst_worldgen'
  | 'dst_world_size'
  | 'dst_branching'
  | 'dst_loop'
  | 'dst_start_location'
  | 'dst_task_set'
  | 'dst_prefabswaps'
  | 'dst_cave_task_set'
  | 'dst_cave_start_location'
  | 'dst_rifts'
  | 'dst_extrastartingitems'
  | 'dst_spawnprotection'
  | 'dst_drop_items'
  | 'dst_health_penalty'
  | 'dst_damage_taken'
  | 'dst_nonlethal'
  | 'dst_petrification'

export interface DstRuleLevelOption {
  label: string
  value: string
}

export interface DstRuleLevelProfile {
  id: DstRuleLevelProfileId
  title: string
  levels: readonly DstRuleLevelOption[]
}

/** 开启 / 关闭（遗留预览） */
export const RULE_LEVELS_BOOLEAN: readonly DstRuleLevelOption[] = [
  { label: '关闭', value: 'false' },
  { label: '开启', value: 'true' },
]

/** 1–10 级密度（遗留预览） */
export const RULE_LEVELS_SCALE: readonly DstRuleLevelOption[] = [
  { label: '1（极小）', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5（中等）', value: '5' },
  { label: '6', value: '6' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  { label: '10（极大）', value: '10' },
]

/** 季节长度（遗留） */
export const RULE_LEVELS_SEASON_LENGTH: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '短', value: 'short' },
  { label: '长', value: 'long' },
  { label: '极长', value: 'verylong' },
]

/** 初始季节（leveldataoverride season_start） */
export const RULE_LEVELS_STARTING_SEASON: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '春', value: 'spring' },
  { label: '夏', value: 'summer' },
  { label: '秋', value: 'autumn' },
  { label: '冬', value: 'winter' },
  { label: '秋或春', value: 'autumnorspring' },
  { label: '冬或夏', value: 'winterorsummer' },
  { label: '随机', value: 'random' },
]

/** 游戏模式（遗留） */
export const RULE_LEVELS_GAME_MODE: readonly DstRuleLevelOption[] = [
  { label: '生存', value: 'survival' },
  { label: '无尽', value: 'endless' },
  { label: '荒野', value: 'wilderness' },
]

/** 倍率（遗留） */
export const RULE_LEVELS_MULTIPLIER: readonly DstRuleLevelOption[] = [
  { label: '0.5x', value: '0.5' },
  { label: '1.0x', value: '1.0' },
  { label: '1.5x', value: '1.5' },
  { label: '2.0x', value: '2.0' },
  { label: '3.0x', value: '3.0' },
]

/** DST 通用难度：never / rare / default / often / always */
export const RULE_LEVELS_DST_DIFFICULTY: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'never' },
  { label: '较少', value: 'rare' },
  { label: '默认', value: 'default' },
  { label: '较多', value: 'often' },
  { label: '极多', value: 'always' },
]

/** DST 再生速度 */
export const RULE_LEVELS_DST_REGROWTH: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'never' },
  { label: '极慢', value: 'veryslow' },
  { label: '慢', value: 'slow' },
  { label: '默认', value: 'default' },
  { label: '快', value: 'fast' },
  { label: '极快', value: 'veryfast' },
]

/** DST 季节长度 */
export const RULE_LEVELS_DST_SEASON: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'noseason' },
  { label: '极短', value: 'veryshortseason' },
  { label: '短', value: 'shortseason' },
  { label: '默认', value: 'default' },
  { label: '长', value: 'longseason' },
  { label: '极长', value: 'verylongseason' },
  { label: '随机', value: 'random' },
]

/** DST 昼夜循环 */
export const RULE_LEVELS_DST_DAY: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '长白天', value: 'longday' },
  { label: '长黄昏', value: 'longdusk' },
  { label: '长夜晚', value: 'longnight' },
  { label: '无白天', value: 'noday' },
  { label: '无黄昏', value: 'nodusk' },
  { label: '无夜晚', value: 'nonight' },
  { label: '仅白天', value: 'onlyday' },
  { label: '仅黄昏', value: 'onlydusk' },
  { label: '仅夜晚', value: 'onlynight' },
]

/** DST 活动年：default / enabled */
export const RULE_LEVELS_DST_EVENT: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '总是', value: 'enabled' },
]

/** DST 二档：none / default */
export const RULE_LEVELS_DST_NONE_DEFAULT: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'none' },
  { label: '默认', value: 'default' },
]

/** DST 出生模式 */
export const RULE_LEVELS_DST_SPAWNMODE: readonly DstRuleLevelOption[] = [
  { label: '绚丽之门', value: 'fixed' },
  { label: '随机', value: 'random' },
]

/** DST 冒险家死亡 */
export const RULE_LEVELS_DST_GHOST: readonly DstRuleLevelOption[] = [
  { label: '变鬼魂', value: 'always' },
  { label: '换人', value: 'none' },
]

/** DST 开关：none / always */
export const RULE_LEVELS_DST_TOGGLE: readonly DstRuleLevelOption[] = [
  { label: '关闭', value: 'none' },
  { label: '开启', value: 'always' },
]

/** DST 全员死亡重置 */
export const RULE_LEVELS_DST_RESETTIME: readonly DstRuleLevelOption[] = [
  { label: '关闭', value: 'none' },
  { label: '慢', value: 'slow' },
  { label: '默认', value: 'default' },
  { label: '快', value: 'fast' },
  { label: '立即', value: 'instant' },
]

/** DST 官方活动 */
export const RULE_LEVELS_DST_SPECIALEVENT: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'none' },
  { label: '自动', value: 'default' },
]

/** DST 世界生成密度 */
export const RULE_LEVELS_DST_WORLDGEN: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'never' },
  { label: '较少', value: 'rare' },
  { label: '默认', value: 'default' },
  { label: '较多', value: 'often' },
  { label: '极多', value: 'always' },
]

/** DST 世界大小 */
export const RULE_LEVELS_DST_WORLD_SIZE: readonly DstRuleLevelOption[] = [
  { label: '小', value: 'small' },
  { label: '中', value: 'medium' },
  { label: '默认', value: 'default' },
  { label: '巨大', value: 'huge' },
]

/** DST 岔路 */
export const RULE_LEVELS_DST_BRANCHING: readonly DstRuleLevelOption[] = [
  { label: '从不', value: 'never' },
  { label: '最少', value: 'least' },
  { label: '默认', value: 'default' },
  { label: '最多', value: 'most' },
  { label: '随机', value: 'random' },
]

/** DST 环形 */
export const RULE_LEVELS_DST_LOOP: readonly DstRuleLevelOption[] = [
  { label: '从不', value: 'never' },
  { label: '默认', value: 'default' },
  { label: '总是', value: 'always' },
]

/** DST 初始环境 */
export const RULE_LEVELS_DST_START_LOCATION: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '加强', value: 'plus' },
  { label: '黑暗', value: 'darkness' },
]

/** DST 地上生物群落 */
export const RULE_LEVELS_DST_TASK_SET: readonly DstRuleLevelOption[] = [
  { label: '经典', value: 'classic' },
  { label: '联机', value: 'default' },
]

/** DST 洞穴生物群落 */
export const RULE_LEVELS_DST_CAVE_TASK_SET: readonly DstRuleLevelOption[] = [
  { label: '经典', value: 'classic' },
  { label: '洞穴默认', value: 'cave_default' },
  { label: '默认', value: 'default' },
]

/** DST 洞穴初始环境 */
export const RULE_LEVELS_DST_CAVE_START_LOCATION: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '加强', value: 'plus' },
  { label: '黑暗', value: 'darkness' },
  { label: '洞穴', value: 'caves' },
]

/** DST 初始资源多样性 */
export const RULE_LEVELS_DST_PREFABSWAPS: readonly DstRuleLevelOption[] = [
  { label: '经典', value: 'classic' },
  { label: '默认', value: 'default' },
  { label: '高度随机', value: 'highly random' },
]

/** DST 荒野裂隙开关 */
export const RULE_LEVELS_DST_RIFTS: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '无', value: 'none' },
  { label: '总是', value: 'always' },
]

/** DST 额外起始资源 */
export const RULE_LEVELS_DST_EXTRASTARTINGITEMS: readonly DstRuleLevelOption[] = [
  { label: '总是', value: 'always' },
  { label: '第 5 天后', value: 'day5' },
  { label: '第 10 天后', value: 'day10' },
  { label: '第 15 天后', value: 'day15' },
  { label: '第 20 天后', value: 'day20' },
  { label: '从不', value: 'never' },
]

/** DST 出生保护 */
export const RULE_LEVELS_DST_SPAWNPROTECTION: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'none' },
  { label: '自动', value: 'default' },
  { label: '总是', value: 'always' },
]

/** DST 断线掉落 */
export const RULE_LEVELS_DST_DROP_ITEMS: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '全部', value: 'everything' },
]

/** DST 生命上限惩罚 */
export const RULE_LEVELS_DST_HEALTH_PENALTY: readonly DstRuleLevelOption[] = [
  { label: '开启', value: 'always' },
  { label: '关闭', value: 'none' },
]

/** DST 受到伤害 */
export const RULE_LEVELS_DST_DAMAGE_TAKEN: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'none' },
  { label: '较少', value: 'always' },
  { label: '较多', value: 'more' },
]

/** DST 非致命伤害 */
export const RULE_LEVELS_DST_NONLETHAL: readonly DstRuleLevelOption[] = [
  { label: '默认', value: 'default' },
  { label: '非致命', value: 'nonlethal' },
]

/** DST 森林石化 */
export const RULE_LEVELS_DST_PETRIFICATION: readonly DstRuleLevelOption[] = [
  { label: '无', value: 'none' },
  { label: '慢', value: 'slow' },
  { label: '默认', value: 'default' },
  { label: '快', value: 'fast' },
  { label: '极快', value: 'veryfast' },
]

export const DST_RULE_LEVEL_PROFILES: readonly DstRuleLevelProfile[] = [
  { id: 'boolean', title: '开关', levels: RULE_LEVELS_BOOLEAN },
  { id: 'scale', title: '密度', levels: RULE_LEVELS_SCALE },
  { id: 'season_length', title: '季节长度', levels: RULE_LEVELS_SEASON_LENGTH },
  { id: 'starting_season', title: '初始季节', levels: RULE_LEVELS_STARTING_SEASON },
  { id: 'game_mode', title: '游戏模式', levels: RULE_LEVELS_GAME_MODE },
  { id: 'multiplier', title: '倍率', levels: RULE_LEVELS_MULTIPLIER },
  { id: 'dst_difficulty', title: '难度', levels: RULE_LEVELS_DST_DIFFICULTY },
  { id: 'dst_regrowth', title: '再生', levels: RULE_LEVELS_DST_REGROWTH },
  { id: 'dst_season', title: '季节', levels: RULE_LEVELS_DST_SEASON },
  { id: 'dst_day', title: '昼夜', levels: RULE_LEVELS_DST_DAY },
  { id: 'dst_event', title: '活动', levels: RULE_LEVELS_DST_EVENT },
  { id: 'dst_none_default', title: '开关', levels: RULE_LEVELS_DST_NONE_DEFAULT },
  { id: 'dst_spawnmode', title: '出生', levels: RULE_LEVELS_DST_SPAWNMODE },
  { id: 'dst_ghost', title: '死亡', levels: RULE_LEVELS_DST_GHOST },
  { id: 'dst_toggle', title: '开关', levels: RULE_LEVELS_DST_TOGGLE },
  { id: 'dst_resettime', title: '重置', levels: RULE_LEVELS_DST_RESETTIME },
  { id: 'dst_specialevent', title: '活动', levels: RULE_LEVELS_DST_SPECIALEVENT },
  { id: 'dst_worldgen', title: '密度', levels: RULE_LEVELS_DST_WORLDGEN },
  { id: 'dst_world_size', title: '大小', levels: RULE_LEVELS_DST_WORLD_SIZE },
  { id: 'dst_branching', title: '岔路', levels: RULE_LEVELS_DST_BRANCHING },
  { id: 'dst_loop', title: '环形', levels: RULE_LEVELS_DST_LOOP },
  { id: 'dst_start_location', title: '环境', levels: RULE_LEVELS_DST_START_LOCATION },
  { id: 'dst_task_set', title: '群落', levels: RULE_LEVELS_DST_TASK_SET },
  { id: 'dst_cave_task_set', title: '群落', levels: RULE_LEVELS_DST_CAVE_TASK_SET },
  { id: 'dst_cave_start_location', title: '环境', levels: RULE_LEVELS_DST_CAVE_START_LOCATION },
  { id: 'dst_prefabswaps', title: '多样性', levels: RULE_LEVELS_DST_PREFABSWAPS },
  { id: 'dst_rifts', title: '裂隙', levels: RULE_LEVELS_DST_RIFTS },
  { id: 'dst_extrastartingitems', title: '资源', levels: RULE_LEVELS_DST_EXTRASTARTINGITEMS },
  { id: 'dst_spawnprotection', title: '保护', levels: RULE_LEVELS_DST_SPAWNPROTECTION },
  { id: 'dst_drop_items', title: '掉落', levels: RULE_LEVELS_DST_DROP_ITEMS },
  { id: 'dst_health_penalty', title: '惩罚', levels: RULE_LEVELS_DST_HEALTH_PENALTY },
  { id: 'dst_damage_taken', title: '伤害', levels: RULE_LEVELS_DST_DAMAGE_TAKEN },
  { id: 'dst_nonlethal', title: '伤害', levels: RULE_LEVELS_DST_NONLETHAL },
  { id: 'dst_petrification', title: '石化', levels: RULE_LEVELS_DST_PETRIFICATION },
]

export function getLevelProfile(id: DstRuleLevelProfileId): DstRuleLevelProfile {
  const profile = DST_RULE_LEVEL_PROFILES.find(p => p.id === id)
  if (!profile) {
    throw new Error(`Unknown level profile: ${id}`)
  }
  return profile
}

export function toSelectOptions(levels: readonly DstRuleLevelOption[]) {
  return levels.map(level => ({ label: level.label, value: level.value }))
}

export function defaultLevelValue(levels: readonly DstRuleLevelOption[]): string {
  if (levels === RULE_LEVELS_BOOLEAN) {
    return 'true'
  }
  if (levels === RULE_LEVELS_SCALE) {
    return '5'
  }
  if (levels === RULE_LEVELS_SEASON_LENGTH) {
    return 'default'
  }
  if (levels === RULE_LEVELS_STARTING_SEASON) {
    return 'default'
  }
  if (levels === RULE_LEVELS_GAME_MODE) {
    return 'survival'
  }
  if (levels === RULE_LEVELS_MULTIPLIER) {
    return '1.0'
  }
  return levels.find(l => l.value === 'default')?.value ?? levels[0]?.value ?? 'default'
}

export function normalizeLevelValue(
  levels: readonly DstRuleLevelOption[],
  value: string | undefined,
): string {
  if (value && levels.some(l => l.value === value)) {
    return value
  }
  return defaultLevelValue(levels)
}
