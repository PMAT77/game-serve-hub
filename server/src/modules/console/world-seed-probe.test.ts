import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldProbeWorldSeed } from './world-seed-probe'

const startedAt = '2026-09-19T10:00:00.000Z'

describe('shouldProbeWorldSeed', () => {
  it('asks when there is no record yet', () => {
    assert.equal(shouldProbeWorldSeed(null, startedAt), true)
  })

  it('skips when the record already covers the current run', () => {
    assert.equal(
      shouldProbeWorldSeed(
        { seed: '1608382646', at: '2026-09-19T10:05:00.000Z', sessionId: 'A' },
        startedAt,
      ),
      false,
    )
  })

  it('asks again when the record predates the current run (world may have changed)', () => {
    assert.equal(
      shouldProbeWorldSeed(
        { seed: '1608382646', at: '2026-09-19T09:00:00.000Z', sessionId: 'A' },
        startedAt,
      ),
      true,
    )
  })

  it('asks when the world was regenerated and the record was invalidated', () => {
    assert.equal(
      shouldProbeWorldSeed(
        { seed: '1608382646', at: '2026-09-19T10:05:00.000Z', sessionId: 'A', stale: true },
        startedAt,
      ),
      true,
    )
  })

  it('asks when the panel does not know when the instance started', () => {
    assert.equal(
      shouldProbeWorldSeed({ seed: '1608382646', at: '2026-09-19T10:05:00.000Z', sessionId: 'A' }, null),
      true,
    )
  })

  it('asks when a timestamp cannot be parsed instead of trusting it', () => {
    assert.equal(
      shouldProbeWorldSeed({ seed: '1608382646', at: 'not-a-time', sessionId: 'A' }, startedAt),
      true,
    )
  })
})
