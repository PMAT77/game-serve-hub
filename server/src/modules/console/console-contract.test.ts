import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  consoleCommandBodySchema,
  consoleLogsQuerySchema,
  consoleStreamQuerySchema,
  consoleStreamTicketSchema,
} from '../../../../shared/contracts/console'

describe('console API contracts', () => {
  it('normalizes console log query defaults', () => {
    const result = consoleLogsQuerySchema.parse({
      instanceId: ' demo-instance ',
      afterId: '12',
    })

    assert.deepEqual(result, {
      instanceId: 'demo-instance',
      afterId: 12,
      stream: 'all',
    })
  })

  it('rejects invalid commands and stream tickets', () => {
    assert.equal(consoleCommandBodySchema.safeParse({
      instanceId: 'demo-instance',
      command: '   ',
      shard: 'unknown',
    }).success, false)
    assert.equal(consoleStreamQuerySchema.safeParse({
      instanceId: 'demo-instance',
      streamTicket: ' ',
    }).success, false)
  })

  it('accepts a valid stream ticket response', () => {
    assert.equal(consoleStreamTicketSchema.safeParse({
      ticket: 'opaque-ticket',
      expiresAt: '2026-07-22T10:00:00.000Z',
    }).success, true)
  })
})
