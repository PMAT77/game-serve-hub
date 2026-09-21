import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inflateSync } from 'node:zlib'
import { createRgbImage, crc32, encodePng, fillCircle, fillRect, readPngSize, setPixel } from './png'

/** 解析 PNG 的块结构，用于对着断言（而不是只信自己的编码器） */
function parseChunks(bytes: Buffer): Array<{ type: string, data: Buffer, crcOk: boolean }> {
  const chunks: Array<{ type: string, data: Buffer, crcOk: boolean }> = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const stored = bytes.readUInt32BE(offset + 8 + length)
    chunks.push({
      type,
      data: Buffer.from(data),
      crcOk: stored === crc32(bytes.subarray(offset + 4, offset + 8 + length)),
    })
    offset += 12 + length
    if (type === 'IEND') {
      break
    }
  }
  return chunks
}

describe('crc32', () => {
  it('与已知向量一致', () => {
    // PNG 规范里的经典校验值
    assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082)
    assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926)
  })
})

describe('encodePng', () => {
  it('产出结构合法的 PNG：签名、IHDR、IDAT、IEND，且每块 CRC 都对', () => {
    const image = createRgbImage(3, 2)
    const bytes = encodePng(image)

    assert.deepEqual(
      bytes.subarray(0, 8),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    const chunks = parseChunks(bytes)
    assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND'])
    assert.equal(chunks.every(c => c.crcOk), true, '每个块的 CRC 都必须正确，否则图片打不开')
  })

  it('IHDR 里的尺寸、位深与颜色类型正确', () => {
    const bytes = encodePng(createRgbImage(7, 5))
    const ihdr = parseChunks(bytes).find(c => c.type === 'IHDR')!.data
    assert.equal(ihdr.readUInt32BE(0), 7)
    assert.equal(ihdr.readUInt32BE(4), 5)
    assert.equal(ihdr[8], 8, '位深应为 8')
    assert.equal(ihdr[9], 2, '颜色类型 2 = 真彩 RGB')
    assert.equal(ihdr[10], 0)
    assert.equal(ihdr[11], 0)
    assert.equal(ihdr[12], 0)
    assert.equal(readPngSize(bytes)?.width, 7)
    assert.equal(readPngSize(bytes)?.height, 5)
  })

  it('像素内容能原样解压回来（含 filter 字节与行序）', () => {
    const image = createRgbImage(2, 2)
    setPixel(image, 0, 0, { r: 1, g: 2, b: 3 })
    setPixel(image, 1, 0, { r: 4, g: 5, b: 6 })
    setPixel(image, 0, 1, { r: 7, g: 8, b: 9 })
    setPixel(image, 1, 1, { r: 10, g: 11, b: 12 })

    const bytes = encodePng(image)
    const idat = parseChunks(bytes).find(c => c.type === 'IDAT')!.data
    const raw = inflateSync(idat)

    // 每行 = 1 字节 filter + 3 字节/像素
    assert.equal(raw.length, 2 * (1 + 2 * 3))
    assert.deepEqual([...raw.subarray(0, 7)], [0, 1, 2, 3, 4, 5, 6])
    assert.deepEqual([...raw.subarray(7, 14)], [0, 7, 8, 9, 10, 11, 12])
  })

  it('尺寸或缓冲不合法时直接报错，不产出打不开的文件', () => {
    assert.throws(() => encodePng({ width: 0, height: 4, pixels: Buffer.alloc(0) }), /尺寸非法/)
    assert.throws(() => encodePng({ width: -1, height: 4, pixels: Buffer.alloc(0) }), /尺寸非法/)
    assert.throws(() => encodePng({ width: 2, height: 2, pixels: Buffer.alloc(5) }), /长度不符/)
  })

  it('像素是 RGB 顺序（不是 BGR）', () => {
    const image = createRgbImage(1, 1)
    setPixel(image, 0, 0, { r: 0xaa, g: 0xbb, b: 0xcc })
    const idat = parseChunks(encodePng(image)).find(c => c.type === 'IDAT')!.data
    const raw = inflateSync(idat)
    assert.deepEqual([...raw], [0, 0xaa, 0xbb, 0xcc])
  })

  it('压缩级别可调，且产出的仍是合法 PNG', () => {
    const image = createRgbImage(64, 64)
    fillRect(image, 0, 0, 64, 64, { r: 110, g: 148, b: 76 })
    const bytes = encodePng(image, 6)
    assert.equal(readPngSize(bytes)?.width, 64)
    assert.equal(parseChunks(bytes).every(chunk => chunk.crcOk), true)
  })

  it('非法的压缩级别被钳住，而不是抛给调用方', () => {
    const image = createRgbImage(2, 2)
    assert.equal(readPngSize(encodePng(image, 99))?.width, 2)
    assert.equal(readPngSize(encodePng(image, Number.NaN))?.width, 2)
  })
})

describe('像素写入', () => {
  it('越界写入被忽略，不越出缓冲', () => {
    const image = createRgbImage(2, 2)
    setPixel(image, -1, 0, { r: 255, g: 255, b: 255 })
    setPixel(image, 2, 0, { r: 255, g: 255, b: 255 })
    setPixel(image, 0, 2, { r: 255, g: 255, b: 255 })
    assert.equal(image.pixels.every(byte => byte === 0), true)
  })

  it('fillRect 裁剪越界部分，且是左闭右开', () => {
    const image = createRgbImage(3, 3)
    fillRect(image, 1, 1, 3, 3, { r: 9, g: 9, b: 9 })
    // (1,1) 与 (2,2) 被填充，(0,0) 没有
    assert.deepEqual([...image.pixels.subarray(0, 3)], [0, 0, 0])
    const at11 = (1 * 3 + 1) * 3
    assert.deepEqual([...image.pixels.subarray(at11, at11 + 3)], [9, 9, 9])

    const clipped = createRgbImage(2, 2)
    fillRect(clipped, -5, -5, 1, 1, { r: 5, g: 5, b: 5 })
    assert.deepEqual([...clipped.pixels.subarray(0, 3)], [5, 5, 5])
    assert.equal(clipped.pixels.filter(byte => byte === 5).length, 3, '只有 (0,0) 一个像素')
  })

  it('fillCircle 画的是圆，不是方块', () => {
    const image = createRgbImage(9, 9)
    fillCircle(image, 4, 4, 2, { r: 255, g: 0, b: 0 })
    const at = (x: number, y: number) => image.pixels[(y * 9 + x) * 3] === 255
    assert.equal(at(4, 4), true, '圆心')
    assert.equal(at(6, 4), true, '半径 2 的正右方')
    assert.equal(at(7, 4), false, '再往外一格不该被填')
    assert.equal(at(6, 6), false, '对角方向的半径外不该被填（方块才会填到那里）')
  })

  it('fillCircle 裁剪越界部分，不越出缓冲', () => {
    const image = createRgbImage(3, 3)
    fillCircle(image, 0, 0, 5, { r: 7, g: 7, b: 7 })
    assert.equal(image.pixels.every(byte => byte === 7), true, '整个画布都在圆内')
  })

  it('fillCircle 半径为 0 时退化成一个像素', () => {
    const image = createRgbImage(3, 3)
    fillCircle(image, 1, 1, 0, { r: 3, g: 3, b: 3 })
    assert.equal(image.pixels.filter(byte => byte === 3).length, 3)
    assert.deepEqual([...image.pixels.subarray((1 * 3 + 1) * 3, (1 * 3 + 1) * 3 + 3)], [3, 3, 3])
  })
})

describe('readPngSize', () => {
  it('非 PNG 或截断数据返回 null', () => {
    assert.equal(readPngSize(Buffer.alloc(0)), null)
    assert.equal(readPngSize(Buffer.from('not a png at all')), null)
    assert.equal(readPngSize(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null)
  })
})
