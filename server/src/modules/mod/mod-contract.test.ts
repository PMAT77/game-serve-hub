import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  modConfigPayloadSchema,
  modInstallPayloadSchema,
  modReorderPayloadSchema,
  steamModListQuerySchema,
} from '../../../../shared/contracts/mod'

describe('mod API contracts', () => {
  it('normalizes install payload identifiers', () => {
    assert.deepEqual(modInstallPayloadSchema.parse({
      workshopId: ' 123456 ',
      dependencyIds: [' 42 '],
      enabled: true,
    }), {
      workshopId: '123456',
      dependencyIds: ['42'],
      enabled: true,
    })
  })

  it('rejects malformed mutation and query payloads', () => {
    assert.equal(modInstallPayloadSchema.safeParse({ workshopId: '' }).success, false)
    assert.equal(modReorderPayloadSchema.safeParse({ workshopIds: '123' }).success, false)
    assert.equal(steamModListQuerySchema.safeParse({ page: {} }).success, false)
  })

  it('validates mod config payload option value types', () => {
    assert.deepEqual(modConfigPayloadSchema.safeParse({ options: { a: 'x', b: 2, c: true } }).success, true)
    assert.deepEqual(modConfigPayloadSchema.safeParse({ options: {} }).success, true)
    assert.equal(modConfigPayloadSchema.safeParse({ options: { a: [1] } }).success, false)
    assert.equal(modConfigPayloadSchema.safeParse({ options: { a: { nested: 1 } } }).success, false)
    assert.equal(modConfigPayloadSchema.safeParse({ options: { '': 1 } }).success, false)
  })
})
