import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInstanceBodySchema,
  instanceActionBodySchema,
  instanceIdsBodySchema,
  instanceListQuerySchema,
} from '../../../../shared/contracts/instance'

describe('instance API contracts', () => {
  it('normalizes list filters and instance identifiers', () => {
    assert.deepEqual(instanceListQuerySchema.parse({
      nodeId: ' local-node ',
      status: 'running',
      keyword: '  dst  ',
    }), {
      nodeId: 'local-node',
      status: 'running',
      keyword: 'dst',
    })

    assert.deepEqual(instanceActionBodySchema.parse({
      id: ' instance-1 ',
      autoAllocatePorts: true,
    }), {
      id: 'instance-1',
      autoAllocatePorts: true,
    })
  })

  it('rejects malformed create and batch-action payloads', () => {
    assert.equal(createInstanceBodySchema.safeParse({
      nodeId: 'local-node',
      name: '   ',
      gameCode: '343050',
    }).success, false)
    assert.equal(createInstanceBodySchema.safeParse({
      nodeId: 'local-node',
      name: 'DST',
      gameCode: '343050',
      gamePort: 65536,
    }).success, false)
    assert.equal(instanceIdsBodySchema.safeParse({
      ids: ['instance-1', ' '],
    }).success, false)
  })
})
