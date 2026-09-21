import type { TileGrid } from './terrain-rle'

/**
 * 地形的简单统计。
 *
 * 单独成文件是为了让"渲染"与"统计"各管一件事：渲染要色板与坐标换算，统计只要数字，
 * 两者都不该为了对方而多引入依赖。图例（`terrain-legend.ts`）建在这之上。
 */

/** 地块 ID → 格数。用 Map 而不是对象：地块 ID 最大到 65535，当键用没有性能问题也不会有原型污染 */
export function countTiles(tiles: TileGrid): Map<number, number> {
  const histogram = new Map<number, number>()
  for (const tile of tiles) {
    histogram.set(tile, (histogram.get(tile) ?? 0) + 1)
  }
  return histogram
}

/**
 * 非零地块占比。
 *
 * 用它在界面上区分"这张图基本是空的"（世界刚生成、大片未探索）与"正常地图"，
 * 而不是让用户对着一张纯色图猜是不是坏了。
 *
 * 不复用直方图：这里只需要"非零格数"，多建一张 Map 反而费事。
 */
export function computeFilledRatio(tiles: TileGrid): number {
  if (tiles.length === 0) {
    return 0
  }
  let filled = 0
  for (const tile of tiles) {
    if (tile !== 0) {
      filled += 1
    }
  }
  return filled / tiles.length
}
