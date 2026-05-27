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

  it('stores shard tag on docker and system lines', () => {
    const instanceId = `test-shard-${Date.now()}`
    instanceConsoleLogStore.appendDockerLine(instanceId, 'surface line', 'master')
    instanceConsoleLogStore.appendDockerLine(instanceId, 'cave line', 'caves')
    instanceConsoleLogStore.appendSystem(instanceId, 'connected', 'caves')
    const rows = instanceConsoleLogStore.listLogs(instanceId)
    assert.equal(rows[0]?.shard, 'master')
    assert.equal(rows[1]?.shard, 'caves')
    assert.equal(rows[2]?.shard, 'caves')
    instanceConsoleLogStore.removeInstance(instanceId)
  })
})
