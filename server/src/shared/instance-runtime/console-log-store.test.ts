import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { instanceConsoleLogStore } from './console-log-store.ts'

describe('instanceConsoleLogStore', () => {
  it('removeInstance clears logs and listeners', () => {
    const instanceId = `test-${Date.now()}`
    instanceConsoleLogStore.appendSystem(instanceId, 'hello')
    assert.ok(instanceConsoleLogStore.listLogs(instanceId).length > 0)

    let notified = false
    const unsubscribe = instanceConsoleLogStore.subscribe(instanceId, () => {
      notified = true
    })
    unsubscribe()

    instanceConsoleLogStore.removeInstance(instanceId)
    assert.equal(instanceConsoleLogStore.listLogs(instanceId).length, 0)
    instanceConsoleLogStore.appendSystem(instanceId, 'after-remove')
    assert.equal(notified, false)
    instanceConsoleLogStore.removeInstance(instanceId)
  })
})
