import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDstOnlinePlayerCountCommand,
  DST_ONLINE_PLAYER_COUNT_MARKER,
  parseDstOnlinePlayerCountLine,
} from './online-players'

describe('buildDstOnlinePlayerCountCommand', () => {
  it('uses AllPlayers and embeds query token', () => {
    const command = buildDstOnlinePlayerCountCommand('a1b2c3d4')
    assert.match(command, /#AllPlayers/)
    assert.match(command, /GSH_PLAYER_COUNT:a1b2c3d4:/)
    assert.doesNotMatch(command, /GetClientTable/)
  })
})

describe('parseDstOnlinePlayerCountLine', () => {
  it('parses marker line from stdout', () => {
    assert.equal(
      parseDstOnlinePlayerCountLine(`${DST_ONLINE_PLAYER_COUNT_MARKER}3`),
      3,
    )
  })

  it('parses marker with query token', () => {
    assert.equal(
      parseDstOnlinePlayerCountLine(`${DST_ONLINE_PLAYER_COUNT_MARKER}a1b2c3d4:3`, 'a1b2c3d4'),
      3,
    )
  })

  it('ignores marker lines from other query tokens', () => {
    assert.equal(
      parseDstOnlinePlayerCountLine(`${DST_ONLINE_PLAYER_COUNT_MARKER}deadbeef:2`, 'a1b2c3d4'),
      null,
    )
  })

  it('parses marker embedded in longer log line', () => {
    assert.equal(
      parseDstOnlinePlayerCountLine(`[00:01:02]: ${DST_ONLINE_PLAYER_COUNT_MARKER}0`),
      0,
    )
    assert.equal(
      parseDstOnlinePlayerCountLine(`[00:01:02]: ${DST_ONLINE_PLAYER_COUNT_MARKER}beef:0`, 'beef'),
      0,
    )
  })

  it('returns null for unrelated lines', () => {
    assert.equal(parseDstOnlinePlayerCountLine('Server is ready'), null)
    assert.equal(parseDstOnlinePlayerCountLine(`${DST_ONLINE_PLAYER_COUNT_MARKER}-1`), null)
  })
})
