import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { collectHostResourceSnapshot } from './host-metrics'

describe('collectHostResourceSnapshot', () => {
  it('returns normalized cpu/memory/disk snapshot', () => {
    const snapshot = collectHostResourceSnapshot()
    assert.ok(snapshot.cpu.cores >= 1)
    assert.ok(snapshot.cpu.usageRate >= 0 && snapshot.cpu.usageRate <= 100)
    assert.ok(snapshot.memory.totalGb > 0)
    assert.ok(snapshot.disk.totalGb >= 0)
  })
})
