import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describePlayerActionOutcome, findPlayerActionError } from './player-action-result'

describe('findPlayerActionError', () => {
  it('finds the Lua error line printed when the command does not exist', () => {
    const hint = findPlayerActionError([
      '> TheNet:Kick("KU_abc")',
      '[00:00:01]: [string "TheNet:Kick(\\"KU_abc\\")"]:1: attempt to call method \'Kick\' (a nil value)',
    ])
    assert.match(hint ?? '', /attempt to call/)
  })

  it('accepts a bare traceback as the clue', () => {
    assert.match(findPlayerActionError(['stack traceback:']) ?? '', /stack traceback/)
  })

  it('returns null for ordinary game output', () => {
    assert.equal(findPlayerActionError([
      '> TheNet:Kick("KU_abc")',
      '[00:00:01]: Client authenticated: (KU_abc) Someone',
      'Sim paused',
    ]), null)
  })

  it('truncates an absurdly long line instead of pasting it into the log', () => {
    const hint = findPlayerActionError([`attempt to call ${'x'.repeat(500)}`])
    assert.ok(hint)
    assert.ok(hint.length <= 201)
  })
})

describe('describePlayerActionOutcome', () => {
  it('reports a kick as done only when the player is gone', () => {
    const outcome = describePlayerActionOutcome({ stillOnline: false, action: 'kick' })
    assert.equal(outcome.verified, true)
    assert.equal(outcome.message, '已踢出该玩家')
  })

  it('reports a ban as done and says it sticks', () => {
    const outcome = describePlayerActionOutcome({ stillOnline: false, action: 'ban' })
    assert.equal(outcome.verified, true)
    assert.equal(outcome.message, '已封禁该玩家')
  })

  it('points a failed kick at the ban action instead of explaining itself', () => {
    const outcome = describePlayerActionOutcome({ stillOnline: true, action: 'kick' })
    assert.equal(outcome.verified, false)
    assert.equal(outcome.message, '没能踢出该玩家，请改用封禁')
  })

  it('keeps the failed ban message short too', () => {
    const outcome = describePlayerActionOutcome({ stillOnline: true, action: 'ban' })
    assert.equal(outcome.verified, false)
    assert.equal(outcome.message, '没能封禁该玩家，请重试')
  })

  it('reports an unknown result as unconfirmed instead of success or failure', () => {
    const outcome = describePlayerActionOutcome({ stillOnline: null, action: 'kick' })
    assert.equal(outcome.verified, false)
    assert.equal(outcome.message, '没能确认结果，请刷新在线列表')
  })

  it('calls the room-owner path what it is: moved out of the world, not kicked', () => {
    // 房主那条连接就是服务器本身，断不开，只能把他送回角色选择界面
    const done = describePlayerActionOutcome({ stillOnline: false, action: 'despawn' })
    assert.equal(done.verified, true)
    assert.equal(done.message, '已把该玩家移出世界')

    const failed = describePlayerActionOutcome({ stillOnline: true, action: 'despawn' })
    assert.equal(failed.verified, false)
    assert.equal(failed.message, '没能把该玩家移出世界，请重试')
  })
})
