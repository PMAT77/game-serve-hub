import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPlayerRoster, flattenShardPlayers } from './player-roster'

const bothShards = [
  { shard: 'master' as const, configured: true, running: true },
  { shard: 'caves' as const, configured: true, running: true },
]

describe('flattenShardPlayers', () => {
  it('tags every player with the world they are in', () => {
    assert.deepEqual(flattenShardPlayers([
      { shard: 'master', players: [{ kuId: 'KU_a', name: '甲' }] },
      { shard: 'caves', players: [{ kuId: 'KU_b', name: '乙' }] },
    ]), [
      { kuId: 'KU_a', name: '甲', shard: 'master' },
      { kuId: 'KU_b', name: '乙', shard: 'caves' },
    ])
  })

  it('ignores a shard that was not queried', () => {
    assert.deepEqual(flattenShardPlayers([{ shard: 'caves', players: null }]), [])
  })
})

describe('buildPlayerRoster', () => {
  it('sums the answered shards and reports a complete roster', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: bothShards,
      snapshots: [
        { shard: 'master', players: [{ kuId: 'KU_a', name: '甲' }] },
        { shard: 'caves', players: [] },
      ],
      maxPlayers: 6,
    })
    assert.equal(roster.running, true)
    assert.equal(roster.onlinePlayerCount, 1)
    assert.equal(roster.partial, false)
    assert.deepEqual(roster.players.map(player => player.kuId), ['KU_a'])
  })

  it('flags a partial roster when a running shard could not be queried', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: bothShards,
      snapshots: [
        { shard: 'master', players: [] },
        { shard: 'caves', players: null },
      ],
      maxPlayers: 6,
    })
    // 洞穴没答上来：人数只算已知的一侧，并明确告知列表可能不全
    assert.equal(roster.partial, true)
    assert.equal(roster.onlinePlayerCount, 0)
    assert.equal(roster.shards.caves.players, null)
  })

  it('does not treat a stopped shard as unknown', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [
        { shard: 'master', configured: true, running: true },
        { shard: 'caves', configured: true, running: false },
      ],
      snapshots: [
        { shard: 'master', players: [] },
        { shard: 'caves', players: [] },
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
      snapshots: [{ shard: 'master', players: null }],
      maxPlayers: 6,
    })
    assert.equal(roster.onlinePlayerCount, null)
    assert.equal(roster.partial, true)
  })

  it('reports the room as stopped when no shard runs', () => {
    const roster = buildPlayerRoster({
      instanceId: 'inst-1',
      plans: [{ shard: 'master', configured: true, running: false }],
      snapshots: [{ shard: 'master', players: [] }],
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
      snapshots: [{ shard: 'master', players: [] }],
      maxPlayers: 6,
    })
    assert.deepEqual(roster.shards.caves, { running: false, configured: false, players: null })
  })
})
