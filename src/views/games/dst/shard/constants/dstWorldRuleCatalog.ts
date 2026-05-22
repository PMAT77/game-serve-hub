import type { DstWorldOption } from './dstWorldAssets'
import type { DstRuleLevelProfileId } from './dstWorldRuleLevels'
import { getLevelProfile } from './dstWorldRuleLevels'

export type DstWorldConfigTab = 'rules' | 'worldgen'

/** 固定条目：无图标资源时也可展示 */
export interface DstWorldRuleCatalogEntry {
  /** server.ini / worldgenoverride overrides 键 */
  overrideKey: string
  labelZh: string
  /** 与 assets 文件名一致，用于匹配图标 */
  iconLabel?: string
  /** 直接指定图标 id（slug） */
  iconId?: string
  /** 覆盖分组默认档位 */
  levelProfileId?: DstRuleLevelProfileId
  /** 仅展示、不可编辑 */
  readOnly?: boolean
}

export interface DstWorldRuleCatalogSection {
  id: string
  title: string
  shard: 'master' | 'caves'
  tab: DstWorldConfigTab
  /** 分组内条目默认档位 */
  levelProfileId: DstRuleLevelProfileId
  entries: DstWorldRuleCatalogEntry[]
}

/**
 * 模块划分对齐 docs/others/master_config.md、caves_config.md 与 leveldataoverride.lua overrides 键。
 * - 世界规则 tab → overrides（世界设置）
 * - 世界生成 tab → overrides（地图生成）
 */
export const DST_WORLD_CONFIG_CATALOG: DstWorldRuleCatalogSection[] = [
  // ── 地上 · 世界规则 ──────────────────────────────────────────
  {
    id: 'master-rules-global',
    title: '全局',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'specialevent', labelZh: '活动', levelProfileId: 'dst_specialevent' },
      { overrideKey: 'autumn', labelZh: '秋', iconLabel: 'Autumn', levelProfileId: 'dst_season' },
      { overrideKey: 'winter', labelZh: '冬', levelProfileId: 'dst_season' },
      { overrideKey: 'spring', labelZh: '春', levelProfileId: 'dst_season' },
      { overrideKey: 'summer', labelZh: '夏', levelProfileId: 'dst_season' },
      { overrideKey: 'day', labelZh: '时长', iconLabel: 'Day', levelProfileId: 'dst_day' },
      { overrideKey: 'spawnmode', labelZh: '出生模式', levelProfileId: 'dst_spawnmode' },
      { overrideKey: 'ghostenabled', labelZh: '冒险家死亡', levelProfileId: 'dst_ghost' },
      { overrideKey: 'portalresurection', labelZh: '在绚丽之门复活', levelProfileId: 'dst_toggle' },
      { overrideKey: 'ghostsanitydrain', labelZh: '鬼魂理智值惩罚', levelProfileId: 'dst_toggle' },
      { overrideKey: 'resettime', labelZh: '死亡重置倒计时', iconLabel: 'Death Reset Timer', levelProfileId: 'dst_resettime' },
      { overrideKey: 'beefaloheat', labelZh: '皮弗娄牛交配频率', iconLabel: 'Beefalo Heat', levelProfileId: 'dst_difficulty' },
      { overrideKey: 'krampus', labelZh: '坎普斯', levelProfileId: 'dst_difficulty' },
    ],
  },
  {
    id: 'master-rules-events',
    title: '活动',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_event',
    entries: [
      { overrideKey: 'crow_carnival', labelZh: '盛夏鸦年华', iconLabel: 'Midsummer Cawnival' },
      { overrideKey: 'hallowed_nights', labelZh: '万圣夜' },
      { overrideKey: 'winters_feast', labelZh: '冬季盛宴' },
      { overrideKey: 'year_of_the_gobbler', labelZh: '火鸡之年' },
      { overrideKey: 'year_of_the_varg', labelZh: '座狼之年' },
      { overrideKey: 'year_of_the_pig', labelZh: '猪王之年' },
      { overrideKey: 'year_of_the_carrat', labelZh: '胡萝卜鼠之年', iconId: 'carrat' },
      { overrideKey: 'year_of_the_beefalo', labelZh: '皮弗娄牛之年', iconId: 'beefalo' },
      { overrideKey: 'year_of_the_catcoon', labelZh: '浣猫之年', iconId: 'catcoon' },
      { overrideKey: 'year_of_the_bunnyman', labelZh: '兔人之年', iconId: 'bunnyman' },
      { overrideKey: 'year_of_the_dragonfly', labelZh: '龙蝇之年', iconId: 'dragonfly' },
      { overrideKey: 'year_of_the_snake', labelZh: '洞穴蠕虫之年' },
      { overrideKey: 'year_of_the_knight', labelZh: '发条骑士之年', iconLabel: 'Clockwork Mobs' },
    ],
  },
  {
    id: 'master-rules-adventurers',
    title: '冒险家',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'extrastartingitems', labelZh: '额外起始资源', levelProfileId: 'dst_extrastartingitems' },
      { overrideKey: 'seasonalstartingitems', labelZh: '季节起始物品', levelProfileId: 'dst_none_default' },
      { overrideKey: 'spawnprotection', labelZh: '防骚扰出生保护', levelProfileId: 'dst_spawnprotection' },
      { overrideKey: 'dropeverythingondespawn', labelZh: '离开游戏后物品掉落', iconLabel: 'Drop Items on Disconnect', levelProfileId: 'dst_drop_items' },
      { overrideKey: 'healthpenalty', labelZh: '生命值上限惩罚', levelProfileId: 'dst_health_penalty' },
      { overrideKey: 'lessdamagetaken', labelZh: '受到的伤害', iconLabel: 'Damage Taken', levelProfileId: 'dst_damage_taken' },
      { overrideKey: 'temperaturedamage', labelZh: '温度伤害', levelProfileId: 'dst_nonlethal' },
      { overrideKey: 'hunger', labelZh: '饥饿伤害', levelProfileId: 'dst_nonlethal' },
      { overrideKey: 'darkness', labelZh: '黑暗伤害', iconLabel: 'Darkness Damage', levelProfileId: 'dst_nonlethal' },
      { overrideKey: 'shadowcreatures', labelZh: '理智怪兽' },
      { overrideKey: 'brightmarecreatures', labelZh: '启蒙怪兽', iconLabel: 'Enlightenment Monsters' },
    ],
  },
  {
    id: 'master-rules-world',
    title: '世界',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'hounds', labelZh: '猎犬攻击' },
      { overrideKey: 'winterhounds', labelZh: '寒冰猎犬群' },
      { overrideKey: 'summerhounds', labelZh: '火焰猎犬群' },
      { overrideKey: 'lunarhail_frequency', labelZh: '月雹' },
      { overrideKey: 'petrification', labelZh: '森林石化', levelProfileId: 'dst_petrification' },
      { overrideKey: 'meteorshowers', labelZh: '流星频率', iconLabel: 'Meteor Frequency' },
      { overrideKey: 'wanderingtrader_enabled', labelZh: '流浪商人' },
      { overrideKey: 'alternatehunt', labelZh: '狩猎惊喜' },
      { overrideKey: 'wildfires', labelZh: '自燃' },
      { overrideKey: 'rifts_enabled', labelZh: '荒野裂隙', levelProfileId: 'dst_rifts' },
      { overrideKey: 'rifts_frequency', labelZh: '荒野裂隙频率' },
      { overrideKey: 'hunt', labelZh: '足迹' },
      { overrideKey: 'lightning', labelZh: '闪电' },
      { overrideKey: 'weather', labelZh: '雨' },
      { overrideKey: 'frograin', labelZh: '青蛙雨' },
    ],
  },
  {
    id: 'master-rules-regrowth',
    title: '资源再生',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_regrowth',
    entries: [
      { overrideKey: 'regrowth', labelZh: '世界再生' },
      { overrideKey: 'cactus_regrowth', labelZh: '仙人掌', iconId: 'cactus' },
      { overrideKey: 'basicresource_regrowth', labelZh: '基础资源', iconLabel: 'Basic Resources', levelProfileId: 'dst_none_default' },
      { overrideKey: 'twiggytrees_regrowth', labelZh: '多枝树' },
      { overrideKey: 'evergreen_regrowth', labelZh: '常青树' },
      { overrideKey: 'moon_tree_regrowth', labelZh: '月树' },
      { overrideKey: 'deciduoustree_regrowth', labelZh: '桦栗树', iconId: 'birchnut_tree' },
      { overrideKey: 'palmconetree_regrowth', labelZh: '棕榈松果树' },
      { overrideKey: 'saltstack_regrowth', labelZh: '盐堆' },
      { overrideKey: 'carrots_regrowth', labelZh: '胡萝卜', iconId: 'carrot' },
      { overrideKey: 'reeds_regrowth', labelZh: '芦苇' },
      { overrideKey: 'flowers_regrowth', labelZh: '花' },
    ],
  },
  {
    id: 'master-rules-portal',
    title: '非自然传送门资源',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'portal_spawnrate', labelZh: '传送频率' },
      { overrideKey: 'lightcrab_portalrate', labelZh: '发光蟹', iconId: 'crustashine' },
      { overrideKey: 'palmcone_seed_portalrate', labelZh: '棕榈松果树芽' },
      { overrideKey: 'powder_monkey_portalrate', labelZh: '火药猴' },
      { overrideKey: 'monkeytail_portalrate', labelZh: '猴尾草', iconId: 'monkeytail' },
      { overrideKey: 'bananabush_portalrate', labelZh: '香蕉丛', iconId: 'banana_bush' },
    ],
  },
  {
    id: 'master-rules-creatures',
    title: '生物',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'gnarwail', labelZh: '一角鲸' },
      { overrideKey: 'penguins', labelZh: '企鸥' },
      { overrideKey: 'bunnymen_setting', labelZh: '兔人', iconId: 'bunnyman' },
      { overrideKey: 'rabbits_setting', labelZh: '兔子' },
      { overrideKey: 'otters_setting', labelZh: '水獭掠夺者' },
      { overrideKey: 'catcoons', labelZh: '浣猫', iconId: 'catcoon' },
      { overrideKey: 'perd', labelZh: '火鸡' },
      { overrideKey: 'pigs_setting', labelZh: '猪' },
      { overrideKey: 'grassgekkos', labelZh: '草壁虎转化' },
      { overrideKey: 'bees_setting', labelZh: '蜜蜂', iconId: 'bee' },
      { overrideKey: 'butterfly', labelZh: '蝴蝶', iconId: 'butterfly' },
      { overrideKey: 'fishschools', labelZh: '鱼群' },
      { overrideKey: 'birds', labelZh: '鸟' },
      { overrideKey: 'moles_setting', labelZh: '鼹鼠', iconId: 'moleworm' },
      { overrideKey: 'wobsters', labelZh: '龙虾' },
    ],
  },
  {
    id: 'master-rules-hostile',
    title: '敌对生物',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'pirates', labelZh: '月亮码头海盗', iconLabel: 'Moon Quay Pirates' },
      { overrideKey: 'wasps', labelZh: '杀人蜂' },
      { overrideKey: 'walrus_setting', labelZh: '海象' },
      { overrideKey: 'hounds', labelZh: '猎犬' },
      { overrideKey: 'mosquitos', labelZh: '蚊子', iconId: 'mosquito' },
      { overrideKey: 'spiders', labelZh: '蜘蛛' },
      { overrideKey: 'spider_warriors', labelZh: '蜘蛛战士' },
      { overrideKey: 'bats', labelZh: '蝙蝠', iconId: 'batilisk' },
      { overrideKey: 'frogs', labelZh: '青蛙' },
      { overrideKey: 'lureplants', labelZh: '食人花', iconId: 'anenemy' },
      { overrideKey: 'cookiecutters', labelZh: '饼干切割机', iconId: 'cookie_cutter' },
      { overrideKey: 'merms', labelZh: '鱼人' },
      { overrideKey: 'squid', labelZh: '鱿鱼' },
      { overrideKey: 'sharks', labelZh: '鲨鱼' },
    ],
  },
  {
    id: 'master-rules-giants',
    title: '巨兽',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'klaus', labelZh: '克劳斯' },
      { overrideKey: 'sharkboi', labelZh: '大霜鲨' },
      { overrideKey: 'crabking', labelZh: '帝王蟹', iconId: 'crabking' },
      { overrideKey: 'eyeofterror', labelZh: '恐怖之眼' },
      { overrideKey: 'daywalker', labelZh: '拾荒疯猪' },
      { overrideKey: 'fruitfly', labelZh: '果蝇王' },
      { overrideKey: 'liefs', labelZh: '树精守卫' },
      { overrideKey: 'deciduousmonster', labelZh: '桦树精' },
      { overrideKey: 'bearger', labelZh: '熊獾', iconId: 'bearger' },
      { overrideKey: 'deerclops', labelZh: '独眼巨鹿', iconId: 'deerclops' },
      { overrideKey: 'antliontribute', labelZh: '蚁狮朝贡', iconId: 'antlion' },
      { overrideKey: 'beequeen', labelZh: '蜂王', iconId: 'bee_queen' },
      { overrideKey: 'spiderqueen', labelZh: '蜘蛛女王' },
      { overrideKey: 'malbatross', labelZh: '邪天翁' },
      { overrideKey: 'goosemoose', labelZh: '麋鹿鹅', iconLabel: 'MooseGoose' },
      { overrideKey: 'dragonfly', labelZh: '龙蝇', iconId: 'dragonfly' },
    ],
  },
  {
    id: 'master-rules-moon-mutation',
    title: '月亮变异',
    shard: 'master',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'mutated_bird_gestalt', labelZh: '亮喙鸟', iconLabel: 'Bright-Beaked Bird' },
      { overrideKey: 'mutated_birds', labelZh: '变异的鸟' },
      { overrideKey: 'mutated_merm', labelZh: '变异鱼人' },
      { overrideKey: 'mutated_hounds', labelZh: '恐怖猎犬' },
      { overrideKey: 'mutated_deerclops', labelZh: '晶体独眼巨鹿', iconLabel: 'Crystal Deerclops' },
      { overrideKey: 'mutated_buzzard_gestalt', labelZh: '水晶冠秃鹫', iconLabel: 'Crystal-Crested Buzzard' },
      { overrideKey: 'penguins_moon', labelZh: '永冻企鸥' },
      { overrideKey: 'moon_spider', labelZh: '破碎蜘蛛' },
      { overrideKey: 'moon_spiders', labelZh: '破碎蜘蛛洞' },
      { overrideKey: 'mutated_bearger', labelZh: '装甲熊獾', iconId: 'armored_bearger' },
      { overrideKey: 'mutated_warg', labelZh: '附身座狼' },
    ],
  },

  // ── 洞穴 · 世界规则 ──────────────────────────────────────────
  {
    id: 'caves-rules-global',
    title: '全局',
    shard: 'caves',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'earthquakes', labelZh: '地震频率', iconLabel: 'Earthquake' },
      { overrideKey: 'worms', labelZh: '大蠕虫', iconId: 'depths_worm' },
      { overrideKey: 'wormattacks', labelZh: '洞穴蠕虫攻击', iconLabel: 'Depths Worm Attacks' },
      { overrideKey: 'rifts_enabled_cave', labelZh: '荒野裂隙', levelProfileId: 'dst_rifts' },
      { overrideKey: 'rifts_frequency_cave', labelZh: '荒野裂隙频率' },
      { overrideKey: 'atriumgate', labelZh: '远古大门', iconId: 'ancient_gateway', levelProfileId: 'dst_regrowth' },
      { overrideKey: 'acidrain_enabled', labelZh: '酸雨', iconLabel: 'Acid Rain', levelProfileId: 'dst_toggle' },
      { overrideKey: 'weather', labelZh: '雨' },
    ],
  },
  {
    id: 'caves-rules-regrowth',
    title: '资源再生',
    shard: 'caves',
    tab: 'rules',
    levelProfileId: 'dst_regrowth',
    entries: [
      { overrideKey: 'regrowth', labelZh: '世界再生' },
      { overrideKey: 'lightflier_flower_regrowth', labelZh: '光虫花', iconId: 'bioluminescence' },
      { overrideKey: 'twiggytrees_regrowth', labelZh: '多枝树' },
      { overrideKey: 'tree_rock_regrowth', labelZh: '巨石枝' },
      { overrideKey: 'evergreen_regrowth', labelZh: '常青树' },
      { overrideKey: 'mushtree_moon_regrowth', labelZh: '月亮蘑菇树' },
      { overrideKey: 'reeds_regrowth', labelZh: '芦苇' },
      { overrideKey: 'flower_cave_regrowth', labelZh: '荧光花', iconId: 'bioluminescence' },
      { overrideKey: 'mushtree_regrowth', labelZh: '蘑菇树' },
    ],
  },
  {
    id: 'caves-rules-creatures',
    title: '生物',
    shard: 'caves',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'bunnymen_setting', labelZh: '兔人', iconId: 'bunnyman' },
      { overrideKey: 'dustmoths', labelZh: '尘蛾' },
      { overrideKey: 'pigs_setting', labelZh: '猪' },
      { overrideKey: 'lightfliers', labelZh: '球状光虫', iconId: 'bioluminescence' },
      { overrideKey: 'rocky_setting', labelZh: '石虾' },
      { overrideKey: 'monkey_setting', labelZh: '穴居猴' },
      { overrideKey: 'grassgekkos', labelZh: '草壁虎转化' },
      { overrideKey: 'mushgnome', labelZh: '蘑菇地精' },
      { overrideKey: 'slurtles_setting', labelZh: '蛞蝓龟' },
      { overrideKey: 'snurtles', labelZh: '蜗牛龟' },
      { overrideKey: 'moles_setting', labelZh: '鼹鼠', iconId: 'moleworm' },
    ],
  },
  {
    id: 'caves-rules-hostile',
    title: '敌对生物',
    shard: 'caves',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'spider_spitter', labelZh: '喷射蜘蛛' },
      { overrideKey: 'itemmimics', labelZh: '拟态蠕虫' },
      { overrideKey: 'chest_mimics', labelZh: '暴躁箱子' },
      { overrideKey: 'cave_spiders', labelZh: '洞穴蜘蛛' },
      { overrideKey: 'spider_hider', labelZh: '穴居蜘蛛' },
      { overrideKey: 'spiders_setting', labelZh: '蜘蛛' },
      { overrideKey: 'spider_warriors', labelZh: '蜘蛛战士' },
      { overrideKey: 'bats_setting', labelZh: '蝙蝠', iconId: 'batilisk' },
      { overrideKey: 'molebats', labelZh: '裸鼹蝠' },
      { overrideKey: 'nightmarecreatures', labelZh: '遗迹梦魇', iconId: 'ancient_spirit' },
      { overrideKey: 'merms', labelZh: '鱼人' },
    ],
  },
  {
    id: 'caves-rules-giants',
    title: '巨兽',
    shard: 'caves',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'fruitfly', labelZh: '果蝇王' },
      { overrideKey: 'liefs', labelZh: '树精守卫' },
      { overrideKey: 'daywalker', labelZh: '梦魇疯猪' },
      { overrideKey: 'toadstool', labelZh: '毒菌蟾蜍' },
      { overrideKey: 'spiderqueen', labelZh: '蜘蛛女王' },
    ],
  },
  {
    id: 'caves-rules-moon-mutation',
    title: '月亮变异',
    shard: 'caves',
    tab: 'rules',
    levelProfileId: 'dst_difficulty',
    entries: [
      { overrideKey: 'mutated_birds', labelZh: '变异的鸟' },
      { overrideKey: 'mutated_merm', labelZh: '变异鱼人' },
      { overrideKey: 'moon_spider', labelZh: '破碎蜘蛛' },
      { overrideKey: 'moon_spiders', labelZh: '破碎蜘蛛洞' },
    ],
  },

  // ── 地上 · 世界生成 ──────────────────────────────────────────
  {
    id: 'master-worldgen-global',
    title: '全局',
    shard: 'master',
    tab: 'worldgen',
    levelProfileId: 'starting_season',
    entries: [
      { overrideKey: 'season_start', labelZh: '初始季节', iconLabel: 'Season Start', levelProfileId: 'starting_season' },
    ],
  },
  {
    id: 'master-worldgen-world',
    title: '世界',
    shard: 'master',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'task_set', labelZh: '生物群落', iconLabel: 'Biomes', levelProfileId: 'dst_task_set' },
      { overrideKey: 'start_location', labelZh: '初始环境', levelProfileId: 'dst_start_location' },
      { overrideKey: 'world_size', labelZh: '世界大小', iconLabel: 'World Size', levelProfileId: 'dst_world_size' },
      { overrideKey: 'branching', labelZh: '岔路地形', levelProfileId: 'dst_branching' },
      { overrideKey: 'loop', labelZh: '环状地形', levelProfileId: 'dst_loop' },
      { overrideKey: 'roads', labelZh: '道路', levelProfileId: 'dst_none_default' },
      { overrideKey: 'touchstone', labelZh: '试金石' },
      { overrideKey: 'boons', labelZh: '前辈' },
      { overrideKey: 'prefabswaps_start', labelZh: '初始资源的多样性', levelProfileId: 'dst_prefabswaps' },
      { overrideKey: 'junk_pile', labelZh: '垃圾场', iconId: 'crate' },
      { overrideKey: 'moon_fissure', labelZh: '天体裂隙', iconLabel: 'Celestial Fissure' },
      { overrideKey: 'itemmimics', labelZh: '小丑' },
      { overrideKey: 'terrariumchest', labelZh: '盒中泰拉' },
      { overrideKey: 'stageplays', labelZh: '舞台剧' },
    ],
  },
  {
    id: 'master-worldgen-resources',
    title: '资源',
    shard: 'master',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'cactus', labelZh: '仙人球', iconId: 'cactus' },
      { overrideKey: 'ocean_bullkelp', labelZh: '公牛海带', iconId: 'bull_kelp' },
      { overrideKey: 'rock', labelZh: '卵石', iconId: 'boulder' },
      { overrideKey: 'marshbush', labelZh: '尖刺灌木' },
      { overrideKey: 'moon_sapling', labelZh: '月亮树苗' },
      { overrideKey: 'moon_rock', labelZh: '月亮石' },
      { overrideKey: 'moon_tree', labelZh: '月树' },
      { overrideKey: 'sapling', labelZh: '树苗' },
      { overrideKey: 'trees', labelZh: '树（全部）' },
      { overrideKey: 'palmconetree', labelZh: '棕榈松果树' },
      { overrideKey: 'ponds', labelZh: '池塘' },
      { overrideKey: 'meteorspawner', labelZh: '流星区域', iconLabel: 'Meteor Frequency' },
      { overrideKey: 'berrybush', labelZh: '浆果丛', iconId: 'berry_bush' },
      { overrideKey: 'moon_bullkelp', labelZh: '海岸公牛海带', iconLabel: 'Beached Bull Kelp' },
      { overrideKey: 'moon_starfish', labelZh: '海星' },
      { overrideKey: 'ocean_seastack', labelZh: '海蚀柱' },
      { overrideKey: 'moon_hotspring', labelZh: '温泉' },
      { overrideKey: 'flint', labelZh: '燧石' },
      { overrideKey: 'rock_avocado', labelZh: '石果灌木丛' },
      { overrideKey: 'carrot', labelZh: '胡萝卜', iconId: 'carrot' },
      { overrideKey: 'reeds', labelZh: '芦苇' },
      { overrideKey: 'flowers', labelZh: '花、恶魔花' },
      { overrideKey: 'grass', labelZh: '草' },
      { overrideKey: 'mushroom', labelZh: '蘑菇' },
      { overrideKey: 'rock_ice', labelZh: '迷你冰川', iconLabel: 'Mini Glacier' },
      { overrideKey: 'tumbleweed', labelZh: '风滚草' },
    ],
  },
  {
    id: 'master-worldgen-creatures',
    title: '生物以及刷新点',
    shard: 'master',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'lightninggoat', labelZh: '伏特羊' },
      { overrideKey: 'rabbits', labelZh: '兔子' },
      { overrideKey: 'otterden', labelZh: '水獭掠夺者窝点' },
      { overrideKey: 'saladmanders', labelZh: '沙拉蝾螈' },
      { overrideKey: 'catcoon', labelZh: '浣猫', iconId: 'catcoon' },
      { overrideKey: 'pigs', labelZh: '猪人' },
      { overrideKey: 'beefalo', labelZh: '皮弗娄牛', iconId: 'beefalo' },
      { overrideKey: 'buzzard', labelZh: '秃鹫', iconId: 'buzzard' },
      { overrideKey: 'carrat', labelZh: '胡萝卜鼠', iconId: 'carrat' },
      { overrideKey: 'bees', labelZh: '蜜蜂', iconId: 'bee' },
      { overrideKey: 'ocean_shoal', labelZh: '鱼群' },
      { overrideKey: 'moles', labelZh: '鼹鼠', iconId: 'moleworm' },
      { overrideKey: 'ocean_wobsterden', labelZh: '龙虾窝' },
    ],
  },
  {
    id: 'master-worldgen-hostile',
    title: '敌对生物以及刷新点',
    shard: 'master',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'chess', labelZh: '发条生物', iconLabel: 'Clockwork Mobs' },
      { overrideKey: 'angrybees', labelZh: '杀人蜂' },
      { overrideKey: 'ocean_waterplant', labelZh: '海草' },
      { overrideKey: 'walrus', labelZh: '海象巢穴' },
      { overrideKey: 'houndmound', labelZh: '猎犬丘' },
      { overrideKey: 'moon_spiders', labelZh: '破碎蜘蛛洞' },
      { overrideKey: 'spiders', labelZh: '蜘蛛' },
      { overrideKey: 'tentacles', labelZh: '触手' },
      { overrideKey: 'tallbirds', labelZh: '高鸟' },
      { overrideKey: 'merm', labelZh: '鱼人' },
    ],
  },

  // ── 洞穴 · 世界生成 ──────────────────────────────────────────
  {
    id: 'caves-worldgen-world',
    title: '世界',
    shard: 'caves',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'task_set', labelZh: '生物群落', iconLabel: 'Biomes', levelProfileId: 'dst_cave_task_set' },
      { overrideKey: 'start_location', labelZh: '初始环境', levelProfileId: 'dst_cave_start_location' },
      { overrideKey: 'world_size', labelZh: '世界大小', levelProfileId: 'dst_world_size' },
      { overrideKey: 'branching', labelZh: '岔路地形', levelProfileId: 'dst_branching' },
      { overrideKey: 'loop', labelZh: '环状地形', levelProfileId: 'dst_loop' },
      { overrideKey: 'touchstone', labelZh: '试金石' },
      { overrideKey: 'cavelight', labelZh: '光照', levelProfileId: 'dst_regrowth' },
      { overrideKey: 'boons', labelZh: '前辈' },
      { overrideKey: 'prefabswaps_start', labelZh: '初始资源的多样性', levelProfileId: 'dst_prefabswaps' },
    ],
  },
  {
    id: 'caves-worldgen-resources',
    title: '资源',
    shard: 'caves',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'rock', labelZh: '卵石', iconId: 'boulder' },
      { overrideKey: 'wormlights', labelZh: '发光浆果', iconId: 'bioluminescence' },
      { overrideKey: 'marshbush', labelZh: '尖刺灌木' },
      { overrideKey: 'tree_rock', labelZh: '巨石枝' },
      { overrideKey: 'sapling', labelZh: '树苗' },
      { overrideKey: 'trees', labelZh: '树（全部）' },
      { overrideKey: 'cave_ponds', labelZh: '池塘' },
      { overrideKey: 'banana', labelZh: '洞穴香蕉', iconLabel: 'Cave Banana Tree' },
      { overrideKey: 'berrybush', labelZh: '浆果丛', iconId: 'berry_bush' },
      { overrideKey: 'flint', labelZh: '燧石' },
      { overrideKey: 'reeds', labelZh: '芦苇' },
      { overrideKey: 'lichen', labelZh: '苔藓' },
      { overrideKey: 'grass', labelZh: '草' },
      { overrideKey: 'flower_cave', labelZh: '荧光花', iconId: 'bioluminescence' },
      { overrideKey: 'fern', labelZh: '蕨类植物', iconLabel: 'Cave Fern' },
      { overrideKey: 'mushroom', labelZh: '蘑菇' },
      { overrideKey: 'mushtree', labelZh: '蘑菇树' },
    ],
  },
  {
    id: 'caves-worldgen-creatures',
    title: '生物以及刷新点',
    shard: 'caves',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'bunnymen', labelZh: '兔人', iconId: 'bunnyman' },
      { overrideKey: 'slurper', labelZh: '啜食者' },
      { overrideKey: 'monkey', labelZh: '猴子' },
      { overrideKey: 'rocky', labelZh: '石虾' },
      { overrideKey: 'slurtles', labelZh: '蛞蝓龟和蜗牛龟' },
    ],
  },
  {
    id: 'caves-worldgen-hostile',
    title: '敌对生物以及刷新点',
    shard: 'caves',
    tab: 'worldgen',
    levelProfileId: 'dst_worldgen',
    entries: [
      { overrideKey: 'chess', labelZh: '发条生物', iconLabel: 'Clockwork Mobs' },
      { overrideKey: 'cave_spiders', labelZh: '洞穴蜘蛛' },
      { overrideKey: 'worms', labelZh: '洞穴蠕虫', iconId: 'depths_worm' },
      { overrideKey: 'spiders', labelZh: '蜘蛛' },
      { overrideKey: 'bats', labelZh: '蝙蝠', iconId: 'batilisk' },
      { overrideKey: 'fissure', labelZh: '裂隙', iconLabel: 'Cave Cleft' },
      { overrideKey: 'tentacles', labelZh: '触手' },
    ],
  },
]

export interface DstWorldRuleRowView {
  overrideKey: string
  labelZh: string
  image?: string
  sectionId: string
  sectionTitle: string
  levelProfileId: DstRuleLevelProfileId
  readOnly?: boolean
}

function resolveImage(
  entry: DstWorldRuleCatalogEntry,
  iconById: Map<string, DstWorldOption>,
  iconByLabel: Map<string, DstWorldOption>,
): string | undefined {
  if (entry.iconId) {
    return iconById.get(entry.iconId)?.image
  }
  if (entry.iconLabel) {
    return iconByLabel.get(entry.iconLabel)?.image
  }
  return undefined
}

export function getCatalogSections(
  shard: 'master' | 'caves',
  tab: DstWorldConfigTab,
): DstWorldRuleCatalogSection[] {
  return DST_WORLD_CONFIG_CATALOG.filter(s => s.shard === shard && s.tab === tab)
}

export function buildWorldConfigRows(
  shard: 'master' | 'caves',
  tab: DstWorldConfigTab,
  allRuleIcons: DstWorldOption[],
): DstWorldRuleRowView[] {
  const iconById = new Map(allRuleIcons.map(o => [o.id, o]))
  const iconByLabel = new Map(allRuleIcons.map(o => [o.label, o]))
  const rows: DstWorldRuleRowView[] = []

  for (const section of getCatalogSections(shard, tab)) {
    for (const entry of section.entries) {
      rows.push({
        overrideKey: entry.overrideKey,
        labelZh: entry.labelZh,
        image: resolveImage(entry, iconById, iconByLabel),
        sectionId: section.id,
        sectionTitle: section.title,
        levelProfileId: entry.levelProfileId ?? section.levelProfileId,
        readOnly: entry.readOnly,
      })
    }
  }

  return rows
}

export function groupWorldConfigRows(rows: DstWorldRuleRowView[]) {
  const sectionOrder: string[] = []
  const grouped = new Map<string, { title: string, items: DstWorldRuleRowView[] }>()

  for (const row of rows) {
    if (!grouped.has(row.sectionId)) {
      sectionOrder.push(row.sectionId)
      grouped.set(row.sectionId, { title: row.sectionTitle, items: [] })
    }
    grouped.get(row.sectionId)!.items.push(row)
  }

  return sectionOrder
    .map((id) => {
      const group = grouped.get(id)
      if (!group || group.items.length === 0) {
        return null
      }
      return { sectionId: id, title: group.title, items: group.items }
    })
    .filter((section): section is NonNullable<typeof section> => section !== null)
}

export function resolveRowLevelProfile(row: DstWorldRuleRowView) {
  return getLevelProfile(row.levelProfileId)
}

/** @deprecated 兼容旧引用 */
export const buildWorldRuleRows = buildWorldConfigRows
/** @deprecated 兼容旧引用 */
export const groupWorldRuleRows = groupWorldConfigRows
