import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildHostMemoryGuidance,
  resolveHostMemoryTier,
} from '../shared/host-memory-guidance.ts'

describe('resolveHostMemoryTier', () => {
  it('classifies ~4GiB as small', () => {
    assert.equal(resolveHostMemoryTier(3900), 'small')
  })

  it('classifies ~6GiB as medium', () => {
    assert.equal(resolveHostMemoryTier(6000), 'medium')
  })

  it('classifies 8GiB+ as large', () => {
    assert.equal(resolveHostMemoryTier(8192), 'large')
  })
})

describe('buildHostMemoryGuidance', () => {
  it('warns caves on small tier', () => {
    const g = buildHostMemoryGuidance({ totalMb: 3900, availableMb: 900 })
    assert.equal(g.tier, 'small')
    assert.ok(g.cavesWarning)
    assert.ok(g.installWarning)
  })

  it('reduces caves warning on large tier', () => {
    const g = buildHostMemoryGuidance({ totalMb: 16384, availableMb: 8000 })
    assert.equal(g.tier, 'large')
    assert.equal(g.cavesWarning, null)
  })
})
