import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WORLD_SEED_LOG_PREFIX,
  buildWorldSeedQueryCommand,
  parseWorldSeedLogLine,
} from './world-seed-parser'

describe('parseWorldSeedLogLine', () => {
  it('reads the seed and world session from a bare marker line', () => {
    assert.deepEqual(parseWorldSeedLogLine('GSHSEED:1608382646|1A2B3C4D5E6F'), {
      seed: '1608382646',
      sessionId: '1A2B3C4D5E6F',
    })
  })

  it('reads the marker embedded in game log noise', () => {
    assert.deepEqual(
      parseWorldSeedLogLine('[00:00:12]: [string "print(...)"] GSHSEED:548421693|0F1E2D'),
      { seed: '548421693', sessionId: '0F1E2D' },
    )
  })

  it('accepts short seeds as the game reports them (no zero padding)', () => {
    assert.deepEqual(parseWorldSeedLogLine('GSHSEED:123456|AB'), { seed: '123456', sessionId: 'AB' })
    assert.deepEqual(parseWorldSeedLogLine('GSHSEED:0|AB'), { seed: '0', sessionId: 'AB' })
  })

  it('keeps the seed when the game has no session identifier (old saves)', () => {
    assert.deepEqual(parseWorldSeedLogLine('GSHSEED:1608382646|nil'), {
      seed: '1608382646',
      sessionId: null,
    })
    assert.deepEqual(parseWorldSeedLogLine('GSHSEED:1608382646'), {
      seed: '1608382646',
      sessionId: null,
    })
  })

  it('reports nil and unusable values as "not read"', () => {
    assert.equal(parseWorldSeedLogLine('GSHSEED:nil|nil'), null)
    assert.equal(parseWorldSeedLogLine('GSHSEED:nil'), null)
    assert.equal(parseWorldSeedLogLine(''), null)
    assert.equal(parseWorldSeedLogLine('[00:00:01]: SimInitializing'), null)
  })

  it('rejects values that are not a plain 1-15 digit number', () => {
    assert.equal(parseWorldSeedLogLine('GSHSEED:1.5|AB'), null)
    assert.equal(parseWorldSeedLogLine('GSHSEED:-7|AB'), null)
    assert.equal(parseWorldSeedLogLine('GSHSEED:1234567890123456|AB'), null)
    assert.equal(parseWorldSeedLogLine('GSHSEED:abc|AB'), null)
  })
})

describe('buildWorldSeedQueryCommand', () => {
  it('embeds the marker prefix, the seed and the world session', () => {
    const command = buildWorldSeedQueryCommand()
    assert.equal(command.includes(WORLD_SEED_LOG_PREFIX), true)
    assert.equal(command.includes('TheWorld.meta.seed'), true)
    assert.equal(command.includes('TheWorld.meta.session_identifier'), true)
    // 世界未加载完时不能因为 nil 索引在控制台抛错
    assert.equal(command.includes('TheWorld and TheWorld.meta and'), true)
  })
})
