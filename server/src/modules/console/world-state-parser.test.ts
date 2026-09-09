import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildWorldStateQueryCommand, parseWorldStateLogLine } from './world-state-parser'

describe('parseWorldStateLogLine', () => {
  it('parses a plain marker line', () => {
    const parsed = parseWorldStateLogLine('GSHWS:102:autumn:3')
    assert.deepEqual(parsed, { cycles: 102, season: 'autumn', daysInSeason: 3 })
  })

  it('parses a marker embedded in console echo noise', () => {
    const parsed = parseWorldStateLogLine('[00:00:12]: [string "print(...)"] GSHWS:5:summer:41')
    assert.deepEqual(parsed, { cycles: 5, season: 'summer', daysInSeason: 41 })
  })

  it('parses mod-defined seasons as plain strings', () => {
    const parsed = parseWorldStateLogLine('GSHWS:0:lunar_island_year:0')
    assert.deepEqual(parsed, { cycles: 0, season: 'lunar_island_year', daysInSeason: 0 })
  })

  it('ignores unrelated log lines', () => {
    assert.equal(parseWorldStateLogLine('[00:00:01]: SimInitializing'), null)
    assert.equal(parseWorldStateLogLine(''), null)
    assert.equal(parseWorldStateLogLine('GSHWS:abc:autumn:3'), null)
    assert.equal(parseWorldStateLogLine('GSHWS:102:autumn'), null)
  })
})

describe('buildWorldStateQueryCommand', () => {
  it('embeds the marker prefix and world state fields', () => {
    const command = buildWorldStateQueryCommand()
    assert.match(command, /print\("GSHWS:"/)
    assert.match(command, /TheWorld\.state\.cycles/)
    assert.match(command, /TheWorld\.state\.season/)
    assert.match(command, /TheWorld\.state\.elapseddaysinseason/)
  })
})
