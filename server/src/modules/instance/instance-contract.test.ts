import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInstanceBodySchema,
  instanceActionBodySchema,
  instanceIdsBodySchema,
  instanceListQuerySchema,
  instanceStatusCountsQuerySchema,
  instanceStatusCountsSchema,
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

  it('keeps status counts query scoped to node and keyword without status', () => {
    assert.deepEqual(instanceStatusCountsQuerySchema.parse({
      nodeId: ' local-node ',
      status: 'running',
      keyword: '  dst  ',
    }), {
      nodeId: 'local-node',
      keyword: 'dst',
    })

    const counts = instanceStatusCountsSchema.parse({
      total: 6,
      pendingInstall: 2,
      running: 1,
      stopped: 2,
      installing: 1,
      error: 0,
    })
    assert.equal(counts.total, 6)
    assert.equal(instanceStatusCountsSchema.safeParse({
      total: -1,
      pendingInstall: 0,
      running: 0,
      stopped: 0,
      installing: 0,
      error: 0,
    }).success, false)
  })

  it('treats empty optional paths on create payload as absent', () => {
    const parsed = createInstanceBodySchema.safeParse({
      nodeId: ' local-node ',
      name: ' 饥荒联机 ',
      gameCode: '343050',
      installPath: '   ',
      configPath: '',
    })
    assert.equal(parsed.success, true)
    assert.deepEqual(parsed.success ? {
      nodeId: parsed.data.nodeId,
      name: parsed.data.name,
      installPath: parsed.data.installPath,
      configPath: parsed.data.configPath,
    } : null, {
      nodeId: 'local-node',
      name: '饥荒联机',
      installPath: undefined,
      configPath: undefined,
    })
  })
})
