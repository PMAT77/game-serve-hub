/**
 * 地形数据的压缩与分块传输格式。
 *
 * 背景（2026-09-21 真机实测）：DST 专用服把**所有写文件通道都封死了**——
 * `io.open` 连游戏自己的 `save` 目录都打不开（七个路径全报 `invalid filepath`），
 * `os.execute` / `os.tmpname` 是 nil，`SetPersistentString` 写了立刻回读为 nil（空操作），
 * `io.write` 是函数、调用也不报错，但**输出不会进控制台日志**。唯一还活着的是 `print`。
 *
 * 所以地形必须**从控制台日志里传回来**。日志有天然约束：单行太长会被截断、行数太多会
 * 刷屏，因此这里做两件事：
 *
 * 1. **RLE 压缩**：地形大片同质，425×425 = 18 万格实测能压到几十 KB；
 * 2. **定长分块 + 序号**：每块自带序号，面板据此重排——即使日志里有行被挤掉，
 *    也能发现缺口并如实报失败，而不是拼出一张错位的地图。
 */

/** 分块前缀；与游戏侧脚本里写死的字符串必须一致 */
export const MAP_CHUNK_MARKER = 'GSHMAPPART:'

/** 每块的最大字符数。保守取值：控制台日志行本身还可能被外部系统再包一层 */
export const MAP_CHUNK_SIZE = 1200

/** 分块总数上限：超出说明编码出了问题，不再无休止地拼 */
export const MAP_CHUNK_MAX_PARTS = 200

/**
 * 地块网格。
 *
 * 用 16 位而不是 8 位：DST 的地块 ID 会**超过 255**——257 猴岛沙滩、264 浮冰都在真实
 * 世界里出现，而 1 字节编码会把它们静默截断成 1（不可通行）与 8（沼泽）。这类错误不会
 * 报错，只会让图上多出几块颜色对不上的地方，属于最难查的一类。
 */
export type TileGrid = Uint8Array | Uint16Array

export interface TileRun {
  tile: number
  count: number
}

/**
 * 把瓦片序列编码成 RLE 十六进制串。
 *
 * 格式：每段 `<4 位十六进制次数><4 位十六进制地块>`。
 * 4 位十六进制表示 1–65535，单段最长 65535 格——地形里超过这个长度的同质段极罕见，
 * 真出现也只是多一段，不影响正确性。地块字段同样取 4 位，覆盖 `INVALID`(65535)。
 */
export function encodeTileRuns(tiles: TileGrid): string {
  if (tiles.length === 0) {
    return ''
  }
  const parts: string[] = []
  let current = tiles[0]!
  let count = 1
  const flush = () => {
    parts.push(count.toString(16).padStart(4, '0'))
    parts.push((current & 0xffff).toString(16).padStart(4, '0'))
  }
  for (let index = 1; index < tiles.length; index += 1) {
    const tile = tiles[index]!
    if (tile === current && count < 0xffff) {
      count += 1
      continue
    }
    flush()
    current = tile
    count = 1
  }
  flush()
  return parts.join('')
}

/**
 * 解码 RLE 串。
 *
 * 失败一律抛错：地形图一旦画错，用户会拿错的地形去选址，比"没图"更糟。
 * 长度不符（多了或少了）也算失败——那说明传输过程丢了数据。
 */
export function decodeTileRuns(payload: string, expectedTiles: number): Uint16Array {
  if (payload.length % 8 !== 0) {
    throw new Error(`地形数据长度不是 8 的倍数（${payload.length}）`)
  }
  if (!/^[0-9a-fA-F]*$/.test(payload)) {
    throw new Error('地形数据不是十六进制')
  }
  const tiles = new Uint16Array(expectedTiles)
  let offset = 0
  for (let index = 0; index < payload.length; index += 8) {
    const count = Number.parseInt(payload.slice(index, index + 4), 16)
    const tile = Number.parseInt(payload.slice(index + 4, index + 8), 16)
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error('地形数据里出现了非法段长度')
    }
    if (!Number.isFinite(tile) || tile < 0 || tile > 0xffff) {
      throw new Error('地形数据里出现了非法地块 ID')
    }
    if (offset + count > expectedTiles) {
      throw new Error(`地形数据超出预期格数（已解出 ${offset + count}，预期 ${expectedTiles}）`)
    }
    tiles.fill(tile, offset, offset + count)
    offset += count
  }
  if (offset !== expectedTiles) {
    throw new Error(`地形数据不完整：解出 ${offset} 格，预期 ${expectedTiles} 格`)
  }
  return tiles
}

/** 把长串切成定长分块；返回每块的内容（不含标记与偏移量前缀） */
export function splitIntoChunks(payload: string, chunkSize: number = MAP_CHUNK_SIZE): string[] {
  if (chunkSize <= 0) {
    throw new Error('分块大小必须为正数')
  }
  const chunks: string[] = []
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    chunks.push(payload.slice(offset, offset + chunkSize))
  }
  return chunks
}

export interface ParsedChunkLines {
  /** 按偏移量排好序、拼接完成的数据串 */
  payload: string
  /** 收到的块数 */
  received: number
  /** 声明的总块数（取各块里出现的最大值）；只有 END 行给出时才有值 */
  expected: number | null
  /** 是否收到了收尾标记 */
  complete: boolean
  /** 缺失的块序号，用于如实报错 */
  missing: number[]
}

/**
 * 从控制台日志行里收集分块。
 *
 * 行格式：`GSHMAPPART:[<token>:]<序号>/<总数>:<内容>`
 *
 * - **序号从 0 开始**；
 * - **token 是可选的**：第一版协议里带着它，但脚本实际输出的是字面量前缀（不含 token），
 *   真机日志证明了这一点——因此正则把 token 组设成可选，避免"发得出、收不到"。
 *
 * 按**序号**而不是出现顺序拼接：日志可能因为刷屏丢行，也可能因为轮询拿到乱序，
 * 按出现顺序拼会得到一张错位的地图而毫无察觉。
 *
 * 正则**必须行尾锚定**：面板下发的 Lua 源码会被游戏原样回显到日志里，回显行同样含
 * `GSHMAPPART:` 字样（`print("GSHMAPPART:"..i.."/"..total..":")`），不锚定就会把回显当成
 * 数据。真机日志里 75 个命中中有 8 个是回显，只有 67 个是真数据——这一条是实测结论。
 */
export function parseChunkLines(lines: string[], queryToken: string): ParsedChunkLines {
  const token = queryToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${MAP_CHUNK_MARKER}(?:${token}:)?(\\d+)/(\\d+):([0-9a-fA-F]*)\\s*$`)
  const collected = new Map<number, string>()
  let expected: number | null = null
  for (const raw of lines) {
    const matched = pattern.exec(raw.trim())
    if (!matched) {
      continue
    }
    const index = Number.parseInt(matched[1]!, 10)
    const total = Number.parseInt(matched[2]!, 10)
    collected.set(index, matched[3] ?? '')
    if (expected === null || total > expected) {
      expected = total
    }
  }

  const missing: number[] = []
  const parts: string[] = []
  const total = expected ?? 0
  for (let index = 0; index < total; index += 1) {
    const part = collected.get(index)
    if (part === undefined) {
      missing.push(index)
      continue
    }
    parts.push(part)
  }

  return {
    payload: parts.join(''),
    received: collected.size,
    expected,
    complete: expected !== null && missing.length === 0 && collected.size >= total,
    missing,
  }
}
