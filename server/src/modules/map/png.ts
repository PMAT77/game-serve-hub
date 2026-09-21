import { deflateSync } from 'node:zlib'

/**
 * 最小 PNG 编码器（RGB8，无依赖）。
 *
 * 为什么自己写而不是引库：面板的运行时依赖是刻意收紧的（`sharp` 至今只是 devDependency），
 * 而地图渲染只需要"把一块像素写成 PNG"这一件事——PNG 的结构足够简单，自己写反而比
 * 引入一个带原生二进制的图像库更可控，也不必为它承担跨平台构建风险。
 *
 * 只实现必要部分：
 * - 每个扫描行前置一个 filter 字节（用 filter 0 = None，色块图压缩率已经很好，不值得上预测器）；
 * - IDAT 用 zlib 压缩（`node:zlib`，零额外依赖）；
 * - 单张 IDAT，不做分块。
 */

/** PNG 文件头：固定的 8 字节签名 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c >>> 0
  }
  return table
})()

/** PNG 每个块都要带 CRC32（对「类型 + 数据」计算） */
export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** 8 位 RGB 像素缓冲；`width * height * 3` 字节，行优先 */
export interface RgbImage {
  width: number
  height: number
  pixels: Buffer
}

export function createRgbImage(width: number, height: number): RgbImage {
  return { width, height, pixels: Buffer.alloc(width * height * 3) }
}

export function setPixel(image: RgbImage, x: number, y: number, color: { r: number, g: number, b: number }): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return
  }
  const offset = (y * image.width + x) * 3
  image.pixels[offset] = color.r & 0xff
  image.pixels[offset + 1] = color.g & 0xff
  image.pixels[offset + 2] = color.b & 0xff
}

/** 填充一个矩形（含左闭右开），越界部分自动裁剪 */
export function fillRect(
  image: RgbImage,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: { r: number, g: number, b: number },
): void {
  const x0 = Math.max(0, Math.floor(left))
  const y0 = Math.max(0, Math.floor(top))
  const x1 = Math.min(image.width, Math.ceil(right))
  const y1 = Math.min(image.height, Math.ceil(bottom))
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      setPixel(image, x, y, color)
    }
  }
}

/**
 * 画实心圆（用于地标标记）。
 *
 * 半径很小（个位数像素），因此直接用矩形包围盒逐点判距离，不需要中点圆算法那套
 * 整数增量——那种写法省的是 CPU，这里省的是"读代码的人要花多久看懂"。越界自动裁剪。
 */
export function fillCircle(
  image: RgbImage,
  centerX: number,
  centerY: number,
  radius: number,
  color: { r: number, g: number, b: number },
): void {
  const r = Math.max(0, Math.floor(radius))
  if (r === 0) {
    setPixel(image, Math.round(centerX), Math.round(centerY), color)
    return
  }
  const cx = Math.round(centerX)
  const cy = Math.round(centerY)
  const squared = r * r
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= squared) {
        setPixel(image, x, y, color)
      }
    }
  }
}

/**
 * 画实心菱形（用于"首领与巢穴"一类的地标标记）。
 *
 * 与圆点、方块一起构成三种可区分的标记形状：颜色再多也会撞，形状不会。
 */
export function fillDiamond(
  image: RgbImage,
  centerX: number,
  centerY: number,
  radius: number,
  color: { r: number, g: number, b: number },
): void {
  const r = Math.max(0, Math.floor(radius))
  const cx = Math.round(centerX)
  const cy = Math.round(centerY)
  for (let y = cy - r; y <= cy + r; y += 1) {
    const span = r - Math.abs(y - cy)
    for (let x = cx - span; x <= cx + span; x += 1) {
      setPixel(image, x, y, color)
    }
  }
}

/** zlib 只接受 0–9；越界会被它直接抛错，这里钳一次，让调用方不必自己校验 */
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 9
  }
  return Math.min(9, Math.max(0, Math.round(level)))
}

/**
 * 把像素编码成 PNG。
 *
 * 尺寸必须为正整数：0 宽的 PNG 是非法文件，与其产出一个打不开的图，不如让调用方
 * 在更早的地方就知道拿不到数据。
 *
 * `level` 是 zlib 压缩级别。默认 9 适合"一张图只编一次"的场景；放大渲染后原始像素
 * 涨到几 MB，色块图在 6 与 9 之间的体积差很小、耗时差很明显，因此地图模块显式传 6。
 */
export function encodePng(image: RgbImage, level = 9): Buffer {
  const { width, height, pixels } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`PNG 尺寸非法：${width}x${height}`)
  }
  const expected = width * height * 3
  if (pixels.length !== expected) {
    throw new Error(`像素缓冲长度不符：期望 ${expected}，实际 ${pixels.length}`)
  }

  // IHDR：宽、高、位深 8、颜色类型 2（真彩 RGB）、压缩/滤波/隔行均为 0
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 逐行加 filter 字节（0 = None）
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3)
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: clampLevel(level) })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 读取 PNG 头部尺寸；用于校验自己产出的图（而非解码整张图） */
export function readPngSize(bytes: Buffer): { width: number, height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null
  }
  if (bytes.readUInt32BE(12) !== 0x49484452) {
    return null
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}
