import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createConsoleStreamTicketStore } from './stream-ticket'

describe('consoleStreamTicketStore', () => {
  it('issues an opaque ticket that can be consumed only once for its instance', () => {
    const store = createConsoleStreamTicketStore({ now: () => 1_000 })
    const issued = store.issue({ instanceId: 'instance-a', userId: 'user-a' })

    assert.equal(store.consume(issued.ticket, 'instance-b'), null)
    assert.deepEqual(store.consume(issued.ticket, 'instance-a'), {
      instanceId: 'instance-a',
      userId: 'user-a',
      expiresAt: 61_000,
    })
    assert.equal(store.consume(issued.ticket, 'instance-a'), null)
  })

  it('rejects expired tickets', () => {
    let currentTime = 1_000
    const store = createConsoleStreamTicketStore({ now: () => currentTime, ttlMs: 100 })
    const issued = store.issue({ instanceId: 'instance-a', userId: 'user-a' })

    currentTime = 1_100
    assert.equal(store.consume(issued.ticket, 'instance-a'), null)
  })
})
