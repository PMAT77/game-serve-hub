import { toHexColor, type Rgb } from './color'
import { findLandmarkByKey, landmarkColor, landmarkShape } from './landmark-catalog'
import { isKnownTile, resolveTileColor, tileLabel } from './terrain-catalog'
import { countTiles } from './terrain-stats'
import type { MarkShape, MapLandmark } from './terrain-render'
import type { TileGrid } from './terrain-rle'

/**
 * 图例：把"这张图上到底有什么"变成人能读的列表。
 *
 * 三条硬要求：
 *
 * 1. **只列这张图上真实出现过的项**（`count > 0`）。列一堆这张图里根本没有的地块，
 *    只会让用户对着色块找不存在的区域。
 * 2. **颜色与图上完全一致**——都从同一个 `resolveTileColor` 取，而不是图例自己再写一份。
 *    图例与图对不上时，错误比"没有图例"严重得多。
 * 3. **没收录的地块要标出来**：面板不认识的 ID 会被排到最前面并带上「未收录」，
 *    这样"该补配色了"是一条看得见的提示，而不是让地图去涂洋红报警。
 */

export interface LegendEntry {
  /** 稳定标识：地形 `terrain:<地块ID>`，地标 `landmark:<分类键>` */
  key: string
  kind: 'terrain' | 'landmark'
  label: string
  /** `#rrggbb`，前端直接拿去当 CSS 颜色 */
  color: string
  /** 地标的标记形状；地形项固定为 null */
  shape: MarkShape | null
  count: number
  /** 地形 = 占全部格子的比例；地标没有"占比"这回事，固定为 null */
  ratio: number | null
  /** 地形：这个地块有没有收录配色；地标恒为 true */
  known: boolean
}

function byCountDescending(a: LegendEntry, b: LegendEntry): number {
  if (b.count !== a.count) {
    return b.count - a.count
  }
  // 计数相同就按 key 排，保证同一份数据每次生成的图例顺序一致（否则界面会无故跳动）
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * 地形图例：按格数降序，一项一种地块。
 *
 * 排序有一条例外——**没收录的地块永远排在最前**。它们通常只占极小的面积（真机上
 * 不到 0.1%），按占比排会沉到列表最底下，而那恰恰是唯一需要人去处理的一项。
 *
 * `gameNames` 是游戏自己回传的「地块 ID → 官方名」，用来给没收录的地块一个像样的名字
 *（`Ice Floe（未收录）` 比 `未收录地块 #263` 有用得多）。
 */
export function buildTerrainLegend(
  tiles: TileGrid,
  palette: Record<number, Rgb>,
  gameNames: ReadonlyMap<number, string> = new Map(),
): LegendEntry[] {
  const total = tiles.length
  if (total === 0) {
    return []
  }
  const entries: LegendEntry[] = []
  for (const [tile, count] of countTiles(tiles)) {
    entries.push({
      key: `terrain:${tile}`,
      kind: 'terrain',
      label: tileLabel(tile, gameNames.get(tile)),
      color: toHexColor(resolveTileColor(tile, palette)),
      shape: null,
      count,
      ratio: count / total,
      known: isKnownTile(tile),
    })
  }
  return entries.sort((a, b) => {
    if (a.known !== b.known) {
      return a.known ? 1 : -1
    }
    return byCountDescending(a, b)
  })
}

/** 地标图例：按分类键分组计数，同一种地标在世界里可能有多处（如多个洞穴入口） */
export function buildLandmarkLegend(landmarks: readonly MapLandmark[]): LegendEntry[] {
  if (landmarks.length === 0) {
    return []
  }
  const counted = new Map<string, number>()
  for (const landmark of landmarks) {
    counted.set(landmark.key, (counted.get(landmark.key) ?? 0) + 1)
  }
  const entries: LegendEntry[] = []
  for (const [key, count] of counted) {
    entries.push({
      key: `landmark:${key}`,
      kind: 'landmark',
      // 目录里查不到就退回用 key 显示：宁可显示英文名，也不要出现一个没有名字的色块
      label: findLandmarkByKey(key)?.label ?? key,
      color: toHexColor(landmarkColor(key)),
      shape: landmarkShape(key),
      count,
      ratio: null,
      known: true,
    })
  }
  return entries.sort(byCountDescending)
}

/** 地形 + 地标合并成一份图例；地形在前，因为它是这张图的主体 */
export function buildLegend(input: {
  tiles: TileGrid
  palette: Record<number, Rgb>
  landmarks: readonly MapLandmark[]
  gameNames?: ReadonlyMap<number, string>
}): LegendEntry[] {
  return [
    ...buildTerrainLegend(input.tiles, input.palette, input.gameNames ?? new Map()),
    ...buildLandmarkLegend(input.landmarks),
  ]
}
