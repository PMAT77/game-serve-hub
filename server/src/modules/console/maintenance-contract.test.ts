import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  maintenanceDraftPayloadSchema,
  maintenanceInstanceQuerySchema,
  maintenancePushPayloadSchema,
} from '../../../../shared/contracts/maintenance'

describe('maintenance API contracts', () => {
  it('normalizes instance and announcement payloads', () => {
    assert.deepEqual(maintenanceInstanceQuerySchema.parse({
      instanceId: ' instance-1 ',
    }), {
      instanceId: 'instance-1',
    })
    assert.deepEqual(maintenanceDraftPayloadSchema.parse({
      instanceId: 'instance-1',
      message: ' planned maintenance ',
    }), {
      instanceId: 'instance-1',
      message: 'planned maintenance',
    })
  })

  it('rejects empty or overlong announcements', () => {
    assert.equal(maintenanceDraftPayloadSchema.safeParse({
      instanceId: 'instance-1',
      message: ' ',
    }).success, false)
    assert.equal(maintenancePushPayloadSchema.safeParse({
      instanceId: 'instance-1',
      message: 'x'.repeat(501),
    }).success, false)
  })
})
