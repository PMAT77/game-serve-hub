import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  playerBanResultSchema,
  playerKickPayloadSchema,
  playerKuIdSchema,
  playerOnlineRosterSchema,
  playerProfileNotePayloadSchema,
} from '../../../../shared/contracts/player'

/**
 * player 模块的契约。
 *
 * 三条口径都是踩过坑才定下来的：Klei ID 的字符集曾漏掉连字符 `-`，把形如
 * `KU_3rpxG-xy` 的真实账号判成非法；在线总览必须区分「这次没查到」与「确实没人」；
 * 踢出允许临时身份、封禁与名单只收 Klei ID。
 */

describe('player API contract', () => {
  it('Klei ID 允许连字符（真实账号形如 KU_3rpxG-xy）', () => {
    assert.equal(playerKuIdSchema.safeParse('KU_3rpxG-xy').success, true)
    assert.equal(playerKuIdSchema.safeParse('KU_3rpxGxy').success, true)
    assert.equal(playerKuIdSchema.safeParse('KU_').success, false)
    assert.equal(playerKuIdSchema.safeParse('76561198000000000').success, false)
  })

  it('踢出接受临时身份 ID，封禁只收 Klei ID', () => {
    assert.equal(
      playerKickPayloadSchema.safeParse({ instanceId: 'inst-1', kuId: '76561198000000000' }).success,
      true,
      '离线或局域网玩家的 ID 不是 Klei 账号，仍应允许踢出',
    )
    assert.equal(
      playerKickPayloadSchema.safeParse({ instanceId: 'inst-1', kuId: '' }).success,
      false,
    )
  })

  it('在线玩家总览区分「没查到」与「确实没人」', () => {
    const result = playerOnlineRosterSchema.safeParse({
      instanceId: 'inst-1',
      running: true,
      maxPlayers: 6,
      onlinePlayerCount: 3,
      shards: {
        master: {
          running: true,
          configured: true,
          players: [{ kuId: 'KU_3rpxG-xy', name: '测试', shard: 'master', kleiAccount: true, key: 'master-1' }],
          count: 2,
          unlistedCount: 1,
        },
        caves: {
          running: false,
          configured: true,
          players: null,
          count: null,
          unlistedCount: 0,
        },
      },
      players: [{ kuId: 'KU_3rpxG-xy', name: '测试', shard: 'master', kleiAccount: true, key: 'master-1' }],
      unlistedPlayerCount: 1,
      partial: true,
    })
    assert.equal(result.success, true)
    assert.equal(result.success && result.data.shards.caves.players, null, '未运行的分片用 null 表示没查，而不是空数组')
  })

  it('封禁结果回带落盘后的黑名单，界面无需再查一次', () => {
    const result = playerBanResultSchema.safeParse({
      isSuccess: true,
      verified: true,
      message: '该玩家已被封禁',
      entries: [{ kuId: 'KU_3rpxG-xy', name: '测试', note: '' }],
    })
    assert.equal(result.success, true)
  })

  it('备注载荷允许清空（空字符串表示清除）', () => {
    const result = playerProfileNotePayloadSchema.safeParse({ instanceId: 'inst-1', kuId: 'KU_3rpxG-xy', note: '' })
    assert.equal(result.success, true)
  })
})
