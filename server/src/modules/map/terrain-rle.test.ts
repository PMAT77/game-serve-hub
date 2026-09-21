import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAP_CHUNK_MARKER,
  MAP_CHUNK_SIZE,
  decodeTileRuns,
  encodeTileRuns,
  parseChunkLines,
  splitIntoChunks,
} from './terrain-rle'

describe('RLE 编码', () => {
  it('同质段被压成一段', () => {
    const tiles = new Uint8Array([3, 3, 3, 3])
    assert.equal(encodeTileRuns(tiles), '00040003')
  })

  it('交替地块各成一段', () => {
    const tiles = new Uint8Array([1, 2, 1, 2])
    assert.equal(encodeTileRuns(tiles), '00010001' + '00010002' + '00010001' + '00010002')
  })

  it('空输入得到空串', () => {
    assert.equal(encodeTileRuns(new Uint8Array(0)), '')
  })

  it('段长度上限 65535：超出会另起一段而不是溢出', () => {
    const tiles = new Uint8Array(70000).fill(9)
    const encoded = encodeTileRuns(tiles)
    // 两段：65535 + 4465，每段 8 字符
    assert.equal(encoded.length, 16)
    assert.equal(encoded.slice(0, 4), 'ffff')
    assert.equal(Number.parseInt(encoded.slice(8, 12), 16), 4465)
  })

  it('地块 ID 用 16 位：超过 255 的值不会被截断成别的 ID', () => {
    /**
     * 真机上确实存在这类 ID（257 猴岛沙滩、264 浮冰）。1 字节编码会把 257 变成 1
     *（不可通行）、264 变成 8（沼泽），而且不报错——图上只会多几块颜色不对的区域。
     */
    assert.equal(encodeTileRuns(new Uint16Array([257, 257])), '00020101')
    assert.equal(encodeTileRuns(new Uint16Array([264])), '00010108')
  })
})

describe('RLE 解码', () => {
  it('编码后能原样还原（往返一致）', () => {
    const original = new Uint8Array([0, 0, 0, 5, 5, 7, 7, 7, 7, 1])
    const restored = decodeTileRuns(encodeTileRuns(original), original.length)
    assert.deepEqual([...restored], [...original])
  })

  it('大块同质地形往返一致', () => {
    const original = new Uint8Array(425 * 425)
    for (let i = 0; i < original.length; i += 1) {
      original[i] = i < 100000 ? 1 : i < 150000 ? 12 : 5
    }
    const restored = decodeTileRuns(encodeTileRuns(original), original.length)
    assert.deepEqual([...restored], [...original])
  })

  it('超过 255 的地块 ID 往返一致（猴岛沙滩 / 浮冰）', () => {
    const original = new Uint16Array([257, 257, 264, 6, 264])
    const restored = decodeTileRuns(encodeTileRuns(original), original.length)
    assert.deepEqual([...restored], [...original])
  })

  it('长度不是 8 的倍数时报错', () => {
    assert.throws(() => decodeTileRuns('000400030', 10), /不是 8 的倍数/)
  })

  it('非十六进制时报错', () => {
    assert.throws(() => decodeTileRuns('zzzzzzzz', 1), /不是十六进制/)
  })

  it('解出的格数少于预期时报错（传输丢数据）', () => {
    assert.throws(() => decodeTileRuns('00040003', 10), /不完整：解出 4 格，预期 10 格/)
  })

  it('解出的格数多于预期时报错', () => {
    assert.throws(() => decodeTileRuns('000a0003', 5), /超出预期格数/)
  })

  it('段长度为 0 时报错', () => {
    assert.throws(() => decodeTileRuns('00000003', 1), /非法段长度/)
  })
})

describe('分块', () => {
  it('按定长切分，最后一块可以更短', () => {
    const payload = 'a'.repeat(2500)
    const chunks = splitIntoChunks(payload, 1000)
    assert.equal(chunks.length, 3)
    assert.equal(chunks[0]!.length, 1000)
    assert.equal(chunks[2]!.length, 500)
    assert.equal(chunks.join(''), payload)
  })

  it('空数据得到 0 块', () => {
    assert.deepEqual(splitIntoChunks('', 100), [])
  })

  it('分块大小非法时报错', () => {
    assert.throws(() => splitIntoChunks('abc', 0), /必须为正数/)
  })

  it('默认块大小在日志行可接受范围内', () => {
    assert.equal(MAP_CHUNK_SIZE > 0 && MAP_CHUNK_SIZE <= 4096, true)
  })
})

describe('分块行解析', () => {
  const line = (token: string, index: number, total: number, body: string) =>
    `${MAP_CHUNK_MARKER}${token}:${index}/${total}:${body}`

  it('按序号拼接，与出现顺序无关', () => {
    const parsed = parseChunkLines([
      line('tok', 2, 3, 'cc'),
      line('tok', 0, 3, 'aa'),
      line('tok', 1, 3, 'bb'),
    ], 'tok')
    assert.equal(parsed.payload, 'aabbcc')
    assert.equal(parsed.received, 3)
    assert.equal(parsed.expected, 3)
    assert.equal(parsed.complete, true)
    assert.deepEqual(parsed.missing, [])
  })

  it('缺块时列出缺了哪几块，且不算完成', () => {
    const parsed = parseChunkLines([
      line('tok', 0, 4, 'aa'),
      line('tok', 2, 4, 'cc'),
    ], 'tok')
    assert.equal(parsed.complete, false)
    assert.deepEqual(parsed.missing, [1, 3])
    // 拼出来的串只含已收到的部分，调用方必须靠 complete 判断，而不是靠长度
    assert.equal(parsed.payload, 'aacc')
  })

  it('还没收到任何块时 complete 为 false', () => {
    const parsed = parseChunkLines(['一些无关日志'], 'tok')
    assert.equal(parsed.complete, false)
    assert.equal(parsed.expected, null)
    assert.equal(parsed.payload, '')
  })

  it('别的 token 的行不串台', () => {
    const parsed = parseChunkLines([line('other', 0, 1, 'aa')], 'tok')
    assert.equal(parsed.received, 0)
  })

  it('同一块重复出现时以最后一条为准（重试/刷屏场景）', () => {
    const parsed = parseChunkLines([
      line('tok', 0, 2, 'aa'),
      line('tok', 0, 2, 'aa'),
      line('tok', 1, 2, 'bb'),
    ], 'tok')
    assert.equal(parsed.payload, 'aabb')
    assert.equal(parsed.complete, true)
  })

  it('行内容带其他文字时仍能取到数据（日志会加时间戳前缀）', () => {
    const parsed = parseChunkLines([
      `[00:01:23]: [string "..."] ${MAP_CHUNK_MARKER}tok:0/1:aabb`,
    ], 'tok')
    assert.equal(parsed.payload, 'aabb')
    assert.equal(parsed.complete, true)
  })
})

describe('端到端：编码 → 分块 → 解析 → 解码', () => {
  it('长地形走完整链路后与原数据一致', () => {
    const width = 425
    const height = 425
    const original = new Uint8Array(width * height)
    for (let i = 0; i < original.length; i += 1) {
      // 造点结构：大块 + 细碎交替，贴近真实地形
      original[i] = i % 7 === 0 ? (i % 13) : (i < 90000 ? 4 : 12)
    }
    const payload = encodeTileRuns(original)
    const chunks = splitIntoChunks(payload)
    const lines = chunks.map((body, index) => `${MAP_CHUNK_MARKER}tok:${index}/${chunks.length}:${body}`)

    const parsed = parseChunkLines(lines, 'tok')
    assert.equal(parsed.complete, true)
    const restored = decodeTileRuns(parsed.payload, original.length)
    assert.deepEqual([...restored], [...original])
  })

  it('RLE 对同质地形的压缩率足够高（决定这条路可行）', () => {
    const original = new Uint8Array(425 * 425)
    for (let i = 0; i < original.length; i += 1) {
      original[i] = i < 100000 ? 1 : i < 160000 ? 12 : 5
    }
    const payload = encodeTileRuns(original)
    /**
     * 四段而不是三段：第一段 100000 格超过单段上限 65535，会被拆成 65535 + 34465。
     * 每段 8 字符 → 32 字符。真实地形比这碎得多，但量级足以说明压缩是有效的。
     */
    assert.equal(payload.length, 32)
  })

  it('碎片化地形的体积仍在可传输范围内（分块参数的依据）', () => {
    /**
     * 造一份"最坏情况"的假地形：每格都与前格不同。
     * 真实地形不会这么碎（地块成片），所以这是上界估计——用它来决定分块大小与轮询预算。
     */
    const original = new Uint8Array(425 * 425)
    for (let i = 0; i < original.length; i += 1) {
      original[i] = (i % 15) + 1
    }
    const payload = encodeTileRuns(original)
    // 最坏情况每段 8 字符：8 × 格数
    assert.equal(payload.length, original.length * 8)
    const chunks = splitIntoChunks(payload)
    // 这个上界决定了轮询必须能容纳多少块——如果真实地形接近它，传输就会很吃力，
    // 因此服务侧的块数上限与轮询预算都要按它来定，而不是按理想压缩率拍脑袋
    assert.equal(chunks.length > 100, true, '最坏情况下块数会很多，服务侧必须有上限与明确失败')
  })
})
