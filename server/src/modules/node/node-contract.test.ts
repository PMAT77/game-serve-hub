import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nodeListItemSchema } from '../../../../shared/contracts/node'

describe('node API contract', () => {
  it('validates a node resource snapshot', () => {
    const result = nodeListItemSchema.safeParse({
      id: 'local-node',
      name: 'Local',
      host: 'localhost',
      sshPort: 22,
      status: 'online',
      resources: {
        cpu: { cores: 8, usageRate: 12.5, availableRate: 87.5 },
        memory: { totalGb: 16, usedGb: 4, freeGb: 12, usageRate: 25 },
        disk: { totalGb: 512, usedGb: 128, freeGb: 384, usageRate: 25 },
      },
      lastHeartbeatAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(result.success, true)
  })
})
