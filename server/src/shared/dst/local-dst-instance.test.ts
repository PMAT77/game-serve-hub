import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FastifyRequest } from 'fastify'
import { LOCAL_NODE_ID, resolveLocalDstInstance } from './local-dst-instance'

function createRequest(): FastifyRequest {
  return { headers: {} } as FastifyRequest
}

describe('resolveLocalDstInstance', () => {
  it('rejects empty instance id', async () => {
    const result = await resolveLocalDstInstance('', createRequest())
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(String(result.error.error), /实例 ID/)
    }
  })

})

describe('LOCAL_NODE_ID', () => {
  it('is stable local node identifier', () => {
    assert.equal(LOCAL_NODE_ID, 'local-node')
  })
})
