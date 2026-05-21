import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assessHostMemoryForHeavyOperation,
  resolveMinHostAvailableMbForOperation,
} from './host-resource-guard.ts'

describe('resolveMinHostAvailableMbForOperation', () => {
  it('steamcmd requirement uses planning peak not docker cap', () => {
    const prevMem = process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
    const prevHead = process.env.GSH_HOST_MEMORY_HEADROOM_MB
    const prevMin = process.env.GSH_HOST_MIN_AVAILABLE_MB
    const prevPlan = process.env.GSH_HOST_STEAMCMD_PLANNING_MB
    delete process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
    delete process.env.GSH_HOST_MEMORY_HEADROOM_MB
    delete process.env.GSH_HOST_MIN_AVAILABLE_MB
    delete process.env.GSH_HOST_STEAMCMD_PLANNING_MB
    const required = resolveMinHostAvailableMbForOperation('steamcmd-install')
    if (prevMem !== undefined) {
      process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB = prevMem
    }
    if (prevHead !== undefined) {
      process.env.GSH_HOST_MEMORY_HEADROOM_MB = prevHead
    }
    if (prevMin !== undefined) {
      process.env.GSH_HOST_MIN_AVAILABLE_MB = prevMin
    }
    if (prevPlan !== undefined) {
      process.env.GSH_HOST_STEAMCMD_PLANNING_MB = prevPlan
    }
    assert.equal(required, 1280 + 512)
  })
})

describe('assessHostMemoryForHeavyOperation', () => {
  it('skips check when /proc/meminfo unavailable', () => {
    const result = assessHostMemoryForHeavyOperation('dst-container-start')
    if (result.availableMb === null) {
      assert.equal(result.ok, true)
    }
  })
})
