import type { Rgb } from './color'

/**
 * 关键地标目录：prefab → 中文名 + 分类 + 标记色。
 *
 * ## 为什么是"每个地标一个颜色"而不是"每个分类一个颜色"
 *
 * 第一版按分类给色（通道青、建筑金、巢穴红），真机上一看就不够用：洞穴入口与复活石
 * 同属"通道"，颜色几乎一样，用户指着图例问"这两个有什么区别"。现在每类地标有自己的颜色，
 * 同分类内部也把色相拉开；分类只保留两个作用——决定**标记形状**（通道圆点、建筑方块、
 * 巢穴菱形）与图例里的分组文案。
 *
 * ## 白名单里多写几个名字没有坏处
 *
 * 图例只会列出**图上真实出现过**的项，所以写错一个 prefab 名最多是"少一个标记"，
 * 不会凭空多出一项假的。反过来说，`spiderden` 与 `spider_den` 这种不确定的拼法可以
 * 两个都写上，命中的那个生效。这也意味着**白名单可以放心加宽**，代价只是脚本长一点。
 */

export type LandmarkCategory = 'portal' | 'structure' | 'boss'

/** 标记形状；同分类共用一种形状，颜色之外再多一层区分 */
export type LandmarkShape = 'circle' | 'square' | 'diamond'

export interface LandmarkSpec {
  /** 面板内部的分类键，图例与标记色都按它走 */
  key: string
  label: string
  category: LandmarkCategory
  /** 标记颜色：每个地标一个，同分类内也拉开色相 */
  color: Rgb
  /** 这个地标在游戏里对应的实体名；同一地标有多种形态时列全（如洞穴入口开/关） */
  prefabs: readonly string[]
}

export const LANDMARK_CATEGORY_LABELS: Record<LandmarkCategory, string> = {
  portal: '通道与入口',
  structure: '建筑与据点',
  boss: '首领与巢穴',
}

export const LANDMARK_SHAPES: Record<LandmarkCategory, LandmarkShape> = {
  portal: 'circle',
  structure: 'square',
  boss: 'diamond',
}

/**
 * 分类的兜底色。
 *
 * 正常情况下用不到——每个地标都有自己的颜色。它只在"面板不认识这个 key"时兜底
 *（比如旧产物里存了已经改名的分类），此时宁可画成显眼的颜色，也不要画成看不见的。
 */
export const LANDMARK_COLORS: Record<LandmarkCategory, Rgb> = {
  portal: { r: 0, g: 229, b: 255 },
  structure: { r: 255, g: 213, b: 79 },
  boss: { r: 255, g: 82, b: 82 },
}

/**
 * 选色原则：高饱和、亮，且刻意避开地形色系（地形是低饱和的蓝 / 绿 / 土黄 / 灰）。
 * 每个标记还会加一圈白衬底（见 `terrain-render.ts`），因此落在深蓝海面或深绿森林上都看得见。
 */
export const LANDMARK_CATALOG: readonly LandmarkSpec[] = [
  // —— 通道与入口 ——
  { key: 'cave_entrance', label: '洞穴入口', category: 'portal', color: { r: 0, g: 229, b: 255 }, prefabs: ['cave_entrance', 'cave_entrance_open'] },
  { key: 'wormhole', label: '虫洞', category: 'portal', color: { r: 0, g: 230, b: 118 }, prefabs: ['wormhole', 'wormhole_limited_1', 'wormhole_limited_2'] },
  { key: 'resurrectionstone', label: '复活石', category: 'portal', color: { r: 224, g: 64, b: 251 }, prefabs: ['resurrectionstone'] },
  { key: 'atrium_gate', label: '远古大门', category: 'portal', color: { r: 83, g: 109, b: 254 }, prefabs: ['atrium_gate'] },

  // —— 建筑与据点 ——
  { key: 'pigking', label: '猪王', category: 'structure', color: { r: 255, g: 213, b: 79 }, prefabs: ['pigking'] },
  { key: 'pighouse', label: '猪人房', category: 'structure', color: { r: 255, g: 152, b: 0 }, prefabs: ['pighouse'] },
  { key: 'mermhouse', label: '鱼人房', category: 'structure', color: { r: 77, g: 182, b: 172 }, prefabs: ['mermhouse'] },
  { key: 'moonbase', label: '月台遗址', category: 'structure', color: { r: 236, g: 239, b: 241 }, prefabs: ['moonbase'] },
  { key: 'glommerstatue', label: '格罗姆雕像', category: 'structure', color: { r: 255, g: 128, b: 171 }, prefabs: ['glommerstatue'] },
  { key: 'octopusking', label: '章鱼王', category: 'structure', color: { r: 244, g: 81, b: 30 }, prefabs: ['octopusking'] },
  { key: 'walrus_camp', label: '海象营地', category: 'structure', color: { r: 129, g: 212, b: 250 }, prefabs: ['walrus_camp'] },
  { key: 'tallbirdnest', label: '高鸟巢', category: 'structure', color: { r: 255, g: 241, b: 118 }, prefabs: ['tallbirdnest'] },
  { key: 'spiderden', label: '蜘蛛巢', category: 'structure', color: { r: 179, g: 157, b: 219 }, prefabs: ['spiderden', 'spider_den'] },
  { key: 'rabbithole', label: '兔洞', category: 'structure', color: { r: 188, g: 170, b: 164 }, prefabs: ['rabbithole', 'rabbit_hole'] },
  { key: 'beehive', label: '蜂巢', category: 'structure', color: { r: 255, g: 202, b: 40 }, prefabs: ['beehive'] },

  // —— 首领与巢穴 ——
  { key: 'antlion', label: '蚁狮', category: 'boss', color: { r: 255, g: 160, b: 0 }, prefabs: ['antlion'] },
  { key: 'beequeenhive', label: '蜂后巢', category: 'boss', color: { r: 255, g: 112, b: 67 }, prefabs: ['beequeenhive'] },
  { key: 'dragonfly', label: '龙蝇', category: 'boss', color: { r: 255, g: 82, b: 82 }, prefabs: ['dragonfly'] },
  { key: 'tentacle', label: '触手', category: 'boss', color: { r: 194, g: 24, b: 91 }, prefabs: ['tentacle'] },
]

const BY_PREFAB = new Map<string, LandmarkSpec>(
  LANDMARK_CATALOG.flatMap(spec => spec.prefabs.map(prefab => [prefab, spec] as const)),
)

const BY_KEY = new Map(LANDMARK_CATALOG.map(spec => [spec.key, spec]))

/** 按 prefab 查目录项；不在白名单里的返回 null（脚本不会回传，这里只是兜底） */
export function resolveLandmark(prefab: string): LandmarkSpec | null {
  return BY_PREFAB.get(prefab) ?? null
}

export function findLandmarkByKey(key: string): LandmarkSpec | null {
  return BY_KEY.get(key) ?? null
}

/** 标记色；未知 key 回落到分类兜底色，宁可显眼也不要画成看不见的颜色 */
export function landmarkColor(key: string): Rgb {
  const spec = BY_KEY.get(key)
  if (spec) {
    return spec.color
  }
  return LANDMARK_COLORS.boss
}

/** 标记形状；图例与图上的形状必须一致，所以两边都从这里取 */
export function landmarkShape(key: string): LandmarkShape {
  return LANDMARK_SHAPES[BY_KEY.get(key)?.category ?? 'boss']
}

/**
 * 生成注入 Lua 脚本的白名单表内容：`pigking=1,cave_entrance=1,...`。
 *
 * 只放 prefab 名，不放中文名与颜色——脚本在游戏进程里跑，多一个用不上的字段就多一份
 * 被上行转义搞坏的机会。
 */
export function landmarkScriptWhitelist(): string {
  return LANDMARK_CATALOG
    .flatMap(spec => spec.prefabs)
    .map(prefab => `${prefab}=1`)
    .join(',')
}
