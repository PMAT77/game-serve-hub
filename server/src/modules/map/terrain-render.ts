import { darken, mix, type Rgb } from './color'
import { createRgbImage, fillCircle, fillDiamond, fillRect, setPixel, type RgbImage } from './png'
import { DEFAULT_TILE_PALETTE, resolveTileColor } from './terrain-catalog'
import type { TileGrid } from './terrain-rle'

/**
 * 地形网格 → RGB 位图。
 *
 * 设计取舍：**色板与坐标换算都做成可覆盖的参数**，因为它们是最可能在真机上"看着不对"
 * 的两处——地块 ID 与颜色的对应关系会随游戏版本漂移，世界坐标到网格坐标的换算依赖
 * 每格的世界单位数与地图尺寸。把它们固定死在函数体内，将来校准就得改渲染逻辑；
 * 做成参数，校准时只改数据。
 *
 * ## 为什么是"放大 + 描边 + 网格"而不是一格一像素
 *
 * 第一版一格一像素，交给浏览器拉伸，实测观感就是一张马赛克：地块边界糊在一起、
 * 没有尺度参照、放大后全是方块。这里改成三件事：
 *
 * 1. **放大 `scale` 倍**（默认 3）：出图分辨率高于显示尺寸，浏览器是缩小显示，
 *    细节不丢，也不会被 `pixelated` 拉伸成硬边；
 * 2. **地块边界描边**：不同地块的交界画一条调暗的细线，大陆轮廓立刻清楚；
 * 3. **坐标网格**：每 50 格一条中性灰线，选址时有个尺度参照。
 *
 * 不画文字刻度：零依赖意味着没有字模，硬画只会更糙；尺寸、种子、时间这些信息由面板承载。
 */

export type { Rgb }
export { DEFAULT_TILE_PALETTE }

/**
 * 地标的默认标记色：高对比的红。脚本能给出分类色时会被覆盖（见 `MapLandmark.color`）。
 *
 * 注意这不是"未收录地块的颜色"——未收录地块按 ID 派生颜色，见 `resolveTileColor`。
 */
export const LANDMARK_COLOR: Rgb = { r: 255, g: 64, b: 48 }

/** 标记外圈的白色衬底，保证标记落在深蓝海洋或深绿森林上都看得见 */
const MARK_RING_COLOR: Rgb = { r: 255, g: 255, b: 255 }

/** 网格线的叠加色：中性灰在深色海面与浅色沙地上都能看见 */
const GRID_COLOR: Rgb = { r: 128, g: 128, b: 128 }

const GRID_BLEND_RATIO = 0.35
const OUTLINE_DARKEN = 0.35

export const DEFAULT_RENDER_SCALE = 3
export const MAX_RENDER_SCALE = 6
export const DEFAULT_GRID_STEP = 50

/**
 * 标记形状。
 *
 * 颜色再多也会撞（19 类地标不可能两两都分得开），形状不会：通道是圆点、建筑是方块、
 * 巢穴是菱形。图例里也用同一套形状，用户在图上对不上色时还能对形状。
 */
export type MarkShape = 'circle' | 'square' | 'diamond'

/**
 * 地标（L2）。
 *
 * 只带渲染需要的四件事：位置、颜色、形状、用于图例归类的 key。名称翻译留在
 * `landmark-catalog.ts`——渲染器不该知道"猪王"这个词。
 */
export interface MapLandmark {
  key: string
  x: number
  z: number
  color?: Rgb
  shape?: MarkShape
}

/**
 * 世界坐标 → 网格坐标的换算参数。
 *
 * DST 每格对应 4 个世界单位（`TILE_SCALE`），网格 `(0,0)` 在世界的左上角，而世界原点
 * 在**地图中心**——因此换算必须知道地图尺寸，不能假设原点就是 `(0,0)`。
 * 这个数字需要对着真机样张校准，所以做成参数。
 */
export interface WorldToTileTransform {
  /** 每格对应的世界单位数 */
  unitsPerTile: number
}

export const DEFAULT_WORLD_TO_TILE: WorldToTileTransform = {
  unitsPerTile: 4,
}

/**
 * 世界坐标 → 网格坐标。
 *
 * 结果可能落在图外（世界生成会给出图外参考点），由绘制侧裁剪。
 */
export function worldToTile(
  x: number,
  z: number,
  width: number,
  height: number,
  transform: WorldToTileTransform = DEFAULT_WORLD_TO_TILE,
): { tileX: number, tileZ: number } {
  const perTile = transform.unitsPerTile > 0 ? transform.unitsPerTile : DEFAULT_WORLD_TO_TILE.unitsPerTile
  return {
    tileX: Math.floor(x / perTile + width / 2),
    tileZ: Math.floor(z / perTile + height / 2),
  }
}

export interface RenderTerrainInput {
  width: number
  height: number
  /** 每格一个地块 ID，长度必须等于 width * height */
  tiles: TileGrid
  landmarks?: MapLandmark[]
  palette?: Record<number, Rgb>
  transform?: WorldToTileTransform
  /** 每格像素数，默认 3，钳制 1–6 */
  scale?: number
  /** 地块边界描边，默认 true（`scale` 为 1 时无意义，自动跳过） */
  outline?: boolean
  /** 坐标网格间隔（格）；0 或负数关闭，默认 50 */
  gridStep?: number
  /** 标记半径（像素）；默认按 `scale` 推算 */
  markRadius?: number
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RENDER_SCALE
  }
  return Math.min(MAX_RENDER_SCALE, Math.max(1, Math.round(value)))
}

/** 线条宽度跟着放大倍率走：放大 3 倍时 1 像素线缩小显示后就看不见了 */
function lineWidthFor(scale: number): number {
  return scale < 2 ? 0 : Math.max(1, Math.round(scale / 2))
}

/** 把一块矩形区域按比例混向某个颜色；网格线用它，好让底下的地块色透出来 */
function blendRect(
  image: RgbImage,
  left: number,
  top: number,
  right: number,
  bottom: number,
  overlay: Rgb,
  ratio: number,
): void {
  const x0 = Math.max(0, Math.floor(left))
  const y0 = Math.max(0, Math.floor(top))
  const x1 = Math.min(image.width, Math.ceil(right))
  const y1 = Math.min(image.height, Math.ceil(bottom))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * image.width + x) * 3
      const base: Rgb = {
        r: image.pixels[offset]!,
        g: image.pixels[offset + 1]!,
        b: image.pixels[offset + 2]!,
      }
      setPixel(image, x, y, mix(base, overlay, ratio))
    }
  }
}

/** 画地块边界：只在**内部**交界处描线，不描图外框（外框是地图边界，不是地块交界） */
function drawTileOutlines(
  image: RgbImage,
  input: { width: number, height: number, tiles: TileGrid, palette: Record<number, Rgb>, scale: number, lineWidth: number },
): void {
  const { width, height, tiles, palette, scale, lineWidth } = input
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const tile = tiles[index]!
      const edge = darken(resolveTileColor(tile, palette), OUTLINE_DARKEN)
      if (x + 1 < width && tiles[index + 1] !== tile) {
        fillRect(image, (x + 1) * scale - lineWidth, y * scale, (x + 1) * scale, (y + 1) * scale, edge)
      }
      if (y + 1 < height && tiles[index + width] !== tile) {
        fillRect(image, x * scale, (y + 1) * scale - lineWidth, (x + 1) * scale, (y + 1) * scale, edge)
      }
    }
  }
}

/** 画坐标网格：每 `gridStep` 格一条线，越过最后一格不画（免得图边出现半格线） */
function drawGrid(image: RgbImage, input: { width: number, height: number, scale: number, step: number, lineWidth: number }): void {
  const { width, height, scale, step, lineWidth } = input
  for (let tileX = step; tileX < width; tileX += step) {
    blendRect(image, tileX * scale - lineWidth, 0, tileX * scale, height * scale, GRID_COLOR, GRID_BLEND_RATIO)
  }
  for (let tileZ = step; tileZ < height; tileZ += step) {
    blendRect(image, 0, tileZ * scale - lineWidth, width * scale, tileZ * scale, GRID_COLOR, GRID_BLEND_RATIO)
  }
}

/**
 * 画一个带白色衬底的标记。
 *
 * 衬底是必需的：标记会落在任意地形上，深蓝海面与深绿森林里都可能出现同一个地标；
 * 白边让它在任何底色上都跳出来。
 */
function drawMark(
  image: RgbImage,
  shape: MarkShape,
  centerX: number,
  centerY: number,
  radius: number,
  color: Rgb,
): void {
  const paint = (r: number, paintColor: Rgb) => {
    if (shape === 'square') {
      // fillRect 是左闭右开：+1 才能画出 (2r+1) 见方的方块
      fillRect(image, centerX - r, centerY - r, centerX + r + 1, centerY + r + 1, paintColor)
      return
    }
    if (shape === 'diamond') {
      fillDiamond(image, centerX, centerY, r, paintColor)
      return
    }
    fillCircle(image, centerX, centerY, r, paintColor)
  }
  paint(radius + 1, MARK_RING_COLOR)
  paint(radius, color)
}

/**
 * 渲染地形图。
 *
 * 一格渲染成 `scale × scale` 个像素，输出尺寸是 `width*scale × height*scale`。
 */
export function renderTerrain(input: RenderTerrainInput): RgbImage {
  const { width, height, tiles } = input
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`地形尺寸非法：${width}x${height}`)
  }
  if (tiles.length !== width * height) {
    throw new Error(`地形数据长度不符：期望 ${width * height}，实际 ${tiles.length}`)
  }
  const palette = input.palette ?? DEFAULT_TILE_PALETTE
  const transform = input.transform ?? DEFAULT_WORLD_TO_TILE
  const scale = clampScale(input.scale ?? DEFAULT_RENDER_SCALE)
  const lineWidth = lineWidthFor(scale)
  const image = createRgbImage(width * scale, height * scale)

  // 1) 放大填充：一格一个色块
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = tiles[y * width + x]!
      // 没收录的地块按 ID 派生颜色：地图要能看，缺配色这件事由渲染侧之外去说
      fillRect(
        image,
        x * scale,
        y * scale,
        (x + 1) * scale,
        (y + 1) * scale,
        resolveTileColor(tile, palette),
      )
    }
  }

  // 2) 地块边界：先描边再画网格，网格压在边界线上面时视觉更整齐
  if ((input.outline ?? true) && lineWidth > 0) {
    drawTileOutlines(image, { width, height, tiles, palette, scale, lineWidth })
  }

  // 3) 坐标网格
  const gridStep = Math.floor(input.gridStep ?? DEFAULT_GRID_STEP)
  if (gridStep > 0 && lineWidth > 0) {
    drawGrid(image, { width, height, scale, step: gridStep, lineWidth })
  }

  // 4) 地标：白衬底 + 分类色标记，落在图外的直接跳过。
  //    半径按放大倍率走：地图缩到面板宽度显示时，太小的点会被降采样吃掉。
  const markRadius = Math.max(3, Math.round(input.markRadius ?? scale * 2))
  for (const landmark of input.landmarks ?? []) {
    const { tileX, tileZ } = worldToTile(landmark.x, landmark.z, width, height, transform)
    if (tileX < 0 || tileZ < 0 || tileX >= width || tileZ >= height) {
      continue
    }
    const centerX = tileX * scale + (scale - 1) / 2
    const centerY = tileZ * scale + (scale - 1) / 2
    drawMark(image, landmark.shape ?? 'circle', centerX, centerY, markRadius, landmark.color ?? LANDMARK_COLOR)
  }

  return image
}
