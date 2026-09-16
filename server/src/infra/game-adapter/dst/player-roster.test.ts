import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DstOnlinePlayer } from './online-players'
import { buildPlayerRoster, flattenShardPlayers } from './player-roster'

const bothShards = [
  { shard: 'master' as const, configured: true, running: true },
  { shard: 'caves' as const, configured: true, running: true },
]

/** 在线明细的四个字段都是必填；非 Klei 账号传 kleiAccount=false */
function player(kuId: string, name: string, kleiAccount = true): DstOnlinePlayer {
  return { kuId, name, kleiAccount, key: kuId.toLowerCase() }
}

describe('flattenShardPlayers', () => {
  it('tags every player with the world they are in', () => {
    assert.deepEqual(flattenShardPlayers([
      { shard: 'master', players: [player('KU_a', '甲')], count: 1 },
      { shard: 'caves', players: [player('KU_b', '乙')], count: 1 },
    ]), [
      { kuId: 'KU_a', name: '甲', shard: 'master', kleiAccount: true, key: 'ku_a' },
      { kuId: 'KU_b', name: '乙', shard: 'caves', kleiAccount: true, key: 'ku_b' },
    ])
  })

  it('ignores a shard that was not queried', () => {
    assert.deepEqual(flattenShardPlayers([{ shard: 'caves', players: null, count: null }]), [])
  })
})

describe('buildPlayerRoster', () => {
  it('sums the answered shards and reports a complete roster', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: bothShards,
      snapshots: [
        { shard: 'master', players: [player('KU_a', '甲')], count: 1 },
        { shard: 'caves', players: [], count: 0 },
      ],
      maxPlayers: 6,
    })
    assert.equal(roster.running, true)
    assert.equal(roster.onlinePlayerCount, 1)
    assert.equal(roster.unlistedPlayerCount, 0)
    assert.equal(roster.partial, false)
    assert.deepEqual(roster.players.map(item => item.kuId), ['KU_a'])
  })

  it('counts players the game reported but gave no usable id for', () => {
    // 人数用游戏侧读数、明细为空——这正是「实例详情说 1 人、玩家管理页说没人」的来源
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [{ shard: 'master', configured: true, running: true }],
      snapshots: [{ shard: 'master', players: [], count: 1 }],
      maxPlayers: 6,
    })
    assert.equal(roster.onlinePlayerCount, 1)
    assert.equal(roster.unlistedPlayerCount, 1)
    assert.equal(roster.shards.master.unlistedCount, 1)
    assert.deepEqual(roster.players, [])
    // 查询本身是成功的，所以不算 partial：界面按 unlistedPlayerCount 说明原因
    assert.equal(roster.partial, false)
  })

  it('keeps a temporary identity in the roster', () => {
    // 离线 / 局域网进来的路人：能列出、能踢，只是不能封禁或写进名单
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [{ shard: 'master', configured: true, running: true }],
      snapshots: [{ shard: 'master', players: [player('Player_3', '路人', false)], count: 1 }],
      maxPlayers: 6,
    })
    assert.deepEqual(roster.players, [
      { kuId: 'Player_3', name: '路人', shard: 'master', kleiAccount: false, key: 'player_3' },
    ])
    assert.equal(roster.unlistedPlayerCount, 0)
  })

  it('flags a partial roster when a running shard could not be queried', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: bothShards,
      snapshots: [
        { shard: 'master', players: [], count: 0 },
        { shard: 'caves', players: null, count: null },
      ],
      maxPlayers: 6,
    })
    // 洞穴没答上来：人数只算已知的一侧，并明确告知列表可能不全
    assert.equal(roster.partial, true)
    assert.equal(roster.onlinePlayerCount, 0)
    assert.equal(roster.shards.caves.players, null)
    // 没答上来的分片不算「有人列不出来」——那是「不知道」，不是「列表缺人」
    assert.equal(roster.unlistedPlayerCount, 0)
  })

  it('does not treat a stopped shard as unknown', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [
        { shard: 'master', configured: true, running: true },
        { shard: 'caves', configured: true, running: false },
      ],
      snapshots: [
        { shard: 'master', players: [], count: 0 },
        { shard: 'caves', players: [], count: 0 },
      ],
      maxPlayers: 6,
    })
    assert.equal(roster.partial, false)
    assert.equal(roster.onlinePlayerCount, 0)
  })

  it('reports an unknown count when nothing could be answered', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [{ shard: 'master', configured: true, running: true }],
      snapshots: [{ shard: 'master', players: null, count: null }],
      maxPlayers: 6,
    })
    assert.equal(roster.onlinePlayerCount, null)
    assert.equal(roster.partial, true)
  })

  it('reports the room as stopped when no shard runs', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [{ shard: 'master', configured: true, running: false }],
      snapshots: [{ shard: 'master', players: [], count: 0 }],
      maxPlayers: 6,
    })
    assert.equal(roster.running, false)
    // 房间没在运行就不报人数（null=没查），与详情页既有口径一致，界面据此显示「—」
    assert.equal(roster.onlinePlayerCount, null)
    assert.equal(roster.partial, false)
  })

  it('always carries both shard slots, even when caves is not configured', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [{ shard: 'master', configured: true, running: false }],
      snapshots: [{ shard: 'master', players: [], count: 0 }],
      maxPlayers: 6,
    })
    assert.deepEqual(roster.shards.caves, {
      running: false,
      configured: false,
      players: null,
      count: null,
      unlistedCount: 0,
    })
  })
})
