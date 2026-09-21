import { deriveTileColor, type Rgb } from './color'

/**
 * 地块目录：ID → 官方名 / 中文名 / 分类 / 颜色。
 *
 * **ID 与官方名来自游戏自己的 `GROUND` / `GROUND_NAMES` 表**（真机打印，78 条），不靠观感猜；
 * 颜色与中文名是面板自己的选择——不追求与游戏内小地图完全一致，只要求"海是蓝的、陆是绿的、
 * 沙是沙色"，相邻地块分得开，且图例里能读出人话。
 *
 * 为什么单独成文件而不是留在渲染器里：图例需要「中文名 + 分类」，渲染只需要「ID → 颜色」。
 * 两边共用同一份数据，才不会出现"图例写着森林、图上画成沼泽"这种对不上的情况。
 *
 * 改色板只改这张表。真机新增 ID 会以洋红显示（见 `terrain-render.ts` 的 `UNKNOWN_TILE_COLOR`），
 * 提醒补映射，而不是悄悄混进地形里。
 */

export type TileCategory = 'ocean' | 'shore' | 'land' | 'special'

export interface TileSpec {
  /** DST 地块常量值 */
  id: number
  /** 官方名（GROUND_NAMES） */
  name: string
  /** 界面上的中文名 */
  label: string
  category: TileCategory
  color: Rgb
}

/** 分类的中文标题，图例分组用 */
export const TILE_CATEGORY_LABELS: Record<TileCategory, string> = {
  ocean: '海域',
  shore: '海岸',
  land: '陆地',
  special: '其它地块',
}

export const TILE_CATALOG: readonly TileSpec[] = [
  // —— 边界与特殊 ——
  { id: 1, name: 'Impassable', label: '不可通行', category: 'special', color: { r: 12, g: 18, b: 32 } },
  { id: 0, name: 'Unexplored', label: '未探索', category: 'special', color: { r: 12, g: 18, b: 32 } },
  { id: 65535, name: 'INVALID', label: '无效地块', category: 'special', color: { r: 12, g: 18, b: 32 } },

  // —— 海洋：按官方名分深浅，浅滩与特殊海域单独给色 ——
  { id: 200, name: 'Fake Ground', label: '虚拟地面', category: 'ocean', color: { r: 18, g: 46, b: 88 } },
  { id: 201, name: 'Coastal Ocean', label: '近岸海域', category: 'ocean', color: { r: 32, g: 82, b: 138 } },
  { id: 202, name: 'Coastal Shore', label: '近岸浅滩', category: 'shore', color: { r: 82, g: 138, b: 176 } },
  { id: 203, name: 'Swell Ocean', label: '涌浪海域', category: 'ocean', color: { r: 24, g: 66, b: 122 } },
  { id: 204, name: 'Rough Ocean', label: '汹涌海域', category: 'ocean', color: { r: 16, g: 46, b: 92 } },
  { id: 205, name: 'Brinepool', label: '盐沼海域', category: 'ocean', color: { r: 26, g: 96, b: 108 } },
  { id: 206, name: 'Brinepool Shore', label: '盐沼浅滩', category: 'shore', color: { r: 96, g: 150, b: 168 } },
  { id: 207, name: 'Hazardous Ocean', label: '危险海域', category: 'ocean', color: { r: 62, g: 34, b: 82 } },
  { id: 208, name: 'Waterlogged Ocean', label: '浮木海域', category: 'ocean', color: { r: 40, g: 110, b: 96 } },
  { id: 257, name: 'Pirate Beach', label: '猴岛沙滩', category: 'shore', color: { r: 214, g: 202, b: 170 } },
  { id: 264, name: 'Ice Floe', label: '浮冰', category: 'ocean', color: { r: 208, g: 226, b: 236 } },
  { id: 32, name: 'Scale', label: '鳞片地面', category: 'land', color: { r: 38, g: 102, b: 94 } },

  // —— 海岸 ——
  { id: 42, name: 'Pebble Beach', label: '卵石滩', category: 'shore', color: { r: 176, g: 166, b: 128 } },
  { id: 44, name: 'Shell Beach', label: '贝壳滩', category: 'shore', color: { r: 216, g: 208, b: 190 } },

  // —— 陆地：按"草地绿 → 林地深绿 → 沙土黄 → 石地灰"排开 ——
  { id: 2, name: 'Road', label: '小路', category: 'land', color: { r: 152, g: 132, b: 98 } },
  { id: 3, name: 'Rocky', label: '岩石地', category: 'land', color: { r: 124, g: 120, b: 114 } },
  { id: 4, name: 'Dirt', label: '泥土地', category: 'land', color: { r: 124, g: 98, b: 66 } },
  { id: 5, name: 'Savanna', label: '稀树草原', category: 'land', color: { r: 148, g: 166, b: 88 } },
  { id: 6, name: 'Grass', label: '草地', category: 'land', color: { r: 110, g: 148, b: 76 } },
  { id: 7, name: 'Forest', label: '森林', category: 'land', color: { r: 68, g: 110, b: 62 } },
  { id: 8, name: 'Marsh', label: '沼泽', category: 'land', color: { r: 84, g: 94, b: 64 } },
  { id: 10, name: 'Wood', label: '木地板', category: 'land', color: { r: 138, g: 112, b: 78 } },
  { id: 13, name: 'Cave', label: '洞穴地面', category: 'land', color: { r: 72, g: 66, b: 60 } },
  { id: 30, name: 'Deciduous', label: '落叶林', category: 'land', color: { r: 96, g: 132, b: 70 } },
  { id: 31, name: 'Desert Dirt', label: '沙漠土', category: 'land', color: { r: 186, g: 168, b: 126 } },
  { id: 43, name: 'Meteor', label: '陨石区', category: 'land', color: { r: 96, g: 84, b: 88 } },
  { id: 46, name: 'Moon Fungus', label: '月菌地面', category: 'land', color: { r: 128, g: 134, b: 156 } },
  { id: 47, name: 'Farming Soil', label: '耕地', category: 'land', color: { r: 110, g: 86, b: 64 } },

  // —— 地下与遗迹（地上地图少见，保留映射以免出现洋红）——
  { id: 11, name: 'Carpet', label: '地毯地面', category: 'special', color: { r: 134, g: 76, b: 68 } },
  { id: 12, name: 'Checkers', label: '棋盘格地面', category: 'special', color: { r: 152, g: 152, b: 142 } },
  { id: 14, name: 'Blue Fungus', label: '蓝色菌毯', category: 'special', color: { r: 92, g: 116, b: 148 } },
  { id: 15, name: 'Sinkhole', label: '塌陷地', category: 'special', color: { r: 58, g: 54, b: 50 } },
  { id: 16, name: 'Under Rock', label: '岩层地面', category: 'special', color: { r: 76, g: 72, b: 68 } },
  { id: 17, name: 'Mud', label: '泥沼', category: 'special', color: { r: 98, g: 86, b: 64 } },
  { id: 18, name: 'Glowing Bricks', label: '发光砖地', category: 'special', color: { r: 140, g: 126, b: 96 } },
  { id: 19, name: 'Pale Bricks', label: '苍白砖地', category: 'special', color: { r: 168, g: 160, b: 140 } },
  { id: 20, name: 'Glowing Tiles', label: '发光地砖', category: 'special', color: { r: 132, g: 132, b: 132 } },
  { id: 21, name: 'Pale Tiles', label: '苍白地砖', category: 'special', color: { r: 126, g: 114, b: 98 } },
  { id: 22, name: 'Glowing Trim', label: '发光镶边', category: 'special', color: { r: 98, g: 98, b: 98 } },
  { id: 23, name: 'Pale Trim', label: '苍白镶边', category: 'special', color: { r: 142, g: 140, b: 132 } },
  { id: 24, name: 'Red Fungus', label: '红色菌毯', category: 'special', color: { r: 140, g: 82, b: 78 } },
  { id: 25, name: 'Green Fungus', label: '绿色菌毯', category: 'special', color: { r: 96, g: 132, b: 88 } },
  { id: 35, name: 'Gorge Peat Forest', label: '泥炭林', category: 'special', color: { r: 88, g: 80, b: 58 } },
  { id: 36, name: 'Gorge Park Grass', label: '公园草地', category: 'special', color: { r: 122, g: 146, b: 84 } },
  { id: 39, name: 'Gorge Soil', label: '园土', category: 'special', color: { r: 92, g: 76, b: 56 } },
  { id: 45, name: 'Archives', label: '档案库地面', category: 'special', color: { r: 150, g: 146, b: 128 } },
]

/** 地块 ID → 颜色。渲染只需要这一张表，因此单独派生出来而不是每次线性查找 */
export const DEFAULT_TILE_PALETTE: Record<number, Rgb> = Object.fromEntries(
  TILE_CATALOG.map(spec => [spec.id, spec.color]),
)

const BY_ID = new Map(TILE_CATALOG.map(spec => [spec.id, spec]))

/** 按 ID 查目录项；未收录的返回 undefined */
export function findTileSpec(id: number): TileSpec | undefined {
  return BY_ID.get(id)
}

/** 这个地块有没有收录（决定图例要不要打"未收录"标记） */
export function isKnownTile(id: number): boolean {
  return BY_ID.has(id)
}

/**
 * 地块的实际用色。
 *
 * 收录了就按色板画；**没收录就按 ID 派生一个稳定的颜色**，而不是一律涂成洋红——
 * 真机上遇到游戏新增地块时，整块地图被洋红抹花的代价远大于收益。
 * "还没收录"这件事由图例和状态提示去说，不靠把地图画花来说。
 */
export function resolveTileColor(id: number, palette: Record<number, Rgb>): Rgb {
  return palette[id] ?? deriveTileColor(id)
}

/** 图例标签最长长度；契约里也是这么限的，超了会被拒 */
const MAX_LABEL_LENGTH = 32

/**
 * 图例上的名字。
 *
 * 三级回落：面板的中文名 → **游戏自己给的官方名** → `未收录地块 #N`。
 * 中间这一级是关键：面板不知道的地块，游戏知道它叫什么，脚本会把它一起传回来，
 * 于是用户看到的至少是 "Ice Floe（未收录）" 而不是一个光秃秃的数字。
 *
 * 未收录的项一定带标记——名字有了不等于配色有了，用户也才知道该提一句。
 */
export function tileLabel(id: number, gameName?: string | null): string {
  const spec = BY_ID.get(id)
  if (spec) {
    return spec.label
  }
  const name = (gameName ?? '').trim()
  const label = name ? `${name}（未收录）` : `未收录地块 #${id}`
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH - 1)}…` : label
}
