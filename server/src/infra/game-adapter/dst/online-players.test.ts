import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDstOnlinePlayerCountCommand,
  buildDstOnlinePlayersCommand,
  DST_ONLINE_PLAYER_COUNT_MARKER,
  DST_ONLINE_PLAYER_LIST_BEGIN_MARKER,
  DST_ONLINE_PLAYER_LIST_END_MARKER,
  DST_ONLINE_PLAYER_LIST_ITEM_MARKER,
  parseDstOnlinePlayerCountLine,
  parseDstOnlinePlayerList,
  resolvePlayerLocation,
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

describe('buildDstOnlinePlayersCommand', () => {
  it('emits the begin, item and end markers with the query token', () => {
    const command = buildDstOnlinePlayersCommand('a1b2c3d4')
    assert.match(command, /GSH_PLAYER_LIST_BEGIN:a1b2c3d4:/)
    assert.match(command, /GSH_PLAYER_LIST_ITEM:a1b2c3d4:/)
    assert.match(command, /GSH_PLAYER_LIST_END:a1b2c3d4/)
    assert.match(command, /pairs\(AllPlayers\)/)
  })

  it('reports the count in the begin marker and separates id from name with a tab', () => {
    const command = buildDstOnlinePlayersCommand('a1b2c3d4')
    assert.match(command, /#AllPlayers/)
    // 生成的 Lua 源码里是转义的 \t，由 Lua 解析成制表符
    assert.match(command, /\\t/)
    assert.match(command, /player\.userid/)
    assert.match(command, /player\.name/)
  })

  it('never falls back to GetClientTable', () => {
    assert.doesNotMatch(buildDstOnlinePlayersCommand('a1b2c3d4'), /GetClientTable/)
  })
})

const TOKEN = 'a1b2c3d4'

function beginLine(count: number): string {
  return `${DST_ONLINE_PLAYER_LIST_BEGIN_MARKER}${TOKEN}:${count}`
}

function itemLine(kuId: string, name: string): string {
  return `${DST_ONLINE_PLAYER_LIST_ITEM_MARKER}${TOKEN}:${kuId}\t${name}`
}

const END_LINE = `${DST_ONLINE_PLAYER_LIST_END_MARKER}${TOKEN}`

describe('parseDstOnlinePlayerList', () => {
  it('parses every player between the begin and end markers', () => {
    assert.deepEqual(parseDstOnlinePlayerList([
      beginLine(2),
      itemLine('KU_aaa', '玩家甲'),
      itemLine('KU_bbb', '玩家乙'),
      END_LINE,
    ], TOKEN), {
      count: 2,
      players: [
        { kuId: 'KU_aaa', name: '玩家甲' },
        { kuId: 'KU_bbb', name: '玩家乙' },
      ],
    })
  })

  it('keeps names that contain spaces and colons', () => {
    const parsed = parseDstOnlinePlayerList([
      beginLine(1),
      itemLine('KU_aaa', '画 家: 范画'),
      END_LINE,
    ], TOKEN)
    assert.equal(parsed?.players[0].name, '画 家: 范画')
  })

  it('accepts an empty name', () => {
    const parsed = parseDstOnlinePlayerList([
      beginLine(1),
      itemLine('KU_aaa', ''),
      END_LINE,
    ], TOKEN)
    assert.equal(parsed?.players[0].name, '')
  })

  it('tolerates the DST log prefix on every line', () => {
    const parsed = parseDstOnlinePlayerList([
      `[00:56:49]: ${beginLine(1)}`,
      `[00:56:49]: ${itemLine('KU_aaa', '玩家甲')}`,
      `[00:56:49]: ${END_LINE}`,
    ], TOKEN)
    assert.deepEqual(parsed?.players, [{ kuId: 'KU_aaa', name: '玩家甲' }])
  })

  it('returns null when the end marker never arrives', () => {
    // 残缺名单比查不到更糟：会被当成「某人已经掉线」
    assert.equal(parseDstOnlinePlayerList([
      beginLine(2),
      itemLine('KU_aaa', '玩家甲'),
    ], TOKEN), null)
  })

  it('returns null for an empty log window', () => {
    assert.equal(parseDstOnlinePlayerList([], TOKEN), null)
  })

  it('ignores markers belonging to another query token', () => {
    assert.equal(parseDstOnlinePlayerList([
      `${DST_ONLINE_PLAYER_LIST_BEGIN_MARKER}deadbeef:1`,
      `${DST_ONLINE_PLAYER_LIST_ITEM_MARKER}deadbeef:KU_aaa\t玩家甲`,
      `${DST_ONLINE_PLAYER_LIST_END_MARKER}deadbeef`,
    ], TOKEN), null)
  })

  it('drops entities whose userid is not a Klei id but keeps the reported count', () => {
    const parsed = parseDstOnlinePlayerList([
      beginLine(2),
      itemLine('not-a-ku-id', '异常实体'),
      itemLine('KU_bbb', '玩家乙'),
      END_LINE,
    ], TOKEN)
    assert.equal(parsed?.count, 2)
    assert.deepEqual(parsed?.players.map(player => player.kuId), ['KU_bbb'])
  })

  it('de-duplicates a player reported twice', () => {
    const parsed = parseDstOnlinePlayerList([
      beginLine(1),
      itemLine('KU_aaa', '玩家甲'),
      itemLine('KU_AAA', '玩家甲'),
      END_LINE,
    ], TOKEN)
    assert.equal(parsed?.players.length, 1)
    assert.equal(parsed?.players[0].kuId, 'KU_aaa')
  })

  it('falls back to the parsed length when the begin marker is missing', () => {
    const parsed = parseDstOnlinePlayerList([
      itemLine('KU_aaa', '玩家甲'),
      END_LINE,
    ], TOKEN)
    assert.equal(parsed?.count, 1)
  })

  it('treats an item without a tab as an empty name', () => {
    const parsed = parseDstOnlinePlayerList([
      beginLine(1),
      `${DST_ONLINE_PLAYER_LIST_ITEM_MARKER}${TOKEN}:KU_aaa`,
      END_LINE,
    ], TOKEN)
    assert.deepEqual(parsed?.players, [{ kuId: 'KU_aaa', name: '' }])
  })
})

describe('resolvePlayerLocation', () => {
  const inMaster = { shard: 'master' as const, players: [{ kuId: 'KU_aaa', name: '甲' }] }
  const inCaves = { shard: 'caves' as const, players: [{ kuId: 'KU_bbb', name: '乙' }] }

  it('locates a player in the shard that reports him', () => {
    assert.deepEqual(resolvePlayerLocation([inMaster, inCaves], 'KU_bbb'), {
      status: 'online',
      shard: 'caves',
    })
  })

  it('matches ids ignoring case', () => {
    assert.deepEqual(resolvePlayerLocation([inMaster, inCaves], 'ku_aaa'), {
      status: 'online',
      shard: 'master',
    })
  })

  it('reports offline only when every shard answered', () => {
    assert.deepEqual(resolvePlayerLocation([
      { shard: 'master', players: [] },
      { shard: 'caves', players: [] },
    ], 'KU_aaa'), { status: 'offline', shard: null })
  })

  it('never claims offline when a shard failed to answer', () => {
    // 洞穴没答上来时，人完全可能就在洞穴里
    assert.deepEqual(resolvePlayerLocation([
      { shard: 'master', players: [] },
      { shard: 'caves', players: null },
    ], 'KU_aaa'), { status: 'unknown', shard: null })
  })

  it('reports unknown when nothing was queried at all', () => {
    assert.deepEqual(resolvePlayerLocation([], 'KU_aaa'), { status: 'unknown', shard: null })
  })
})
