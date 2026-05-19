/** Docker multiplexed stream frame: 8-byte header + payload */
export function stripDockerLogFrame(chunk: Buffer): string {
  const { text } = decodeDockerMultiplexLogChunk(Buffer.alloc(0), chunk)
  return text
}

/** 解析 Docker 多路复用日志帧，返回可拼接文本与未消费的字节 */
export function decodeDockerMultiplexLogChunk(
  carry: Buffer,
  chunk: Buffer,
): { text: string, carry: Buffer } {
  const buffer = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
  let offset = 0
  const parts: string[] = []

  while (offset + 8 <= buffer.length) {
    const frameSize = buffer.readUInt32BE(offset + 4)
    if (!Number.isFinite(frameSize) || frameSize < 0 || frameSize > 16 * 1024 * 1024) {
      offset += 1
      continue
    }
    if (offset + 8 + frameSize > buffer.length) {
      break
    }
    parts.push(buffer.subarray(offset + 8, offset + 8 + frameSize).toString('utf8'))
    offset += 8 + frameSize
  }

  return {
    text: parts.join(''),
    carry: Buffer.from(buffer.subarray(offset)),
  }
}
