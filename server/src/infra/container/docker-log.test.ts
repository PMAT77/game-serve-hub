import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeDockerMultiplexLogChunk } from './docker-log.ts'

function encodeDockerLogFrame(payload: string, streamType = 1): Buffer {
  const body = Buffer.from(payload, 'utf8')
  const header = Buffer.alloc(8)
  header[0] = streamType
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

describe('decodeDockerMultiplexLogChunk', () => {
  it('decodes a single multiplexed frame', () => {
    const chunk = encodeDockerLogFrame('Hello\nWorld')
    const decoded = decodeDockerMultiplexLogChunk(Buffer.alloc(0), chunk)
    assert.equal(decoded.text, 'Hello\nWorld')
    assert.equal(decoded.carry.length, 0)
  })

  it('keeps incomplete frame bytes in carry buffer', () => {
    const chunk = encodeDockerLogFrame('partial')
    const incomplete = chunk.subarray(0, 10)
    const decoded = decodeDockerMultiplexLogChunk(Buffer.alloc(0), incomplete)
    assert.equal(decoded.text, '')
    assert.ok(decoded.carry.length > 0)

    const rest = chunk.subarray(10)
    const merged = decodeDockerMultiplexLogChunk(decoded.carry, rest)
    assert.equal(merged.text, 'partial')
    assert.equal(merged.carry.length, 0)
  })
})
