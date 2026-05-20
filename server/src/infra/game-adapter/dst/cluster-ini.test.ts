import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildClusterIni,
  deriveNetworkMode,
  networkModeToIniFlags,
  parseClusterIni,
  validateClusterFields,
} from './cluster-ini'
import { maskClusterToken, normalizeClusterToken, validateClusterToken } from './cluster-token'

describe('cluster-ini', () => {
  it('maps network modes to ini flags', () => {
    assert.deepEqual(networkModeToIniFlags('offline'), { offline_cluster: true, lan_only_cluster: false })
    assert.deepEqual(networkModeToIniFlags('lan_only'), { offline_cluster: false, lan_only_cluster: true })
    assert.deepEqual(networkModeToIniFlags('public'), { offline_cluster: false, lan_only_cluster: false })
  })

  it('derives network mode from ini flags', () => {
    assert.equal(deriveNetworkMode(true, false).networkMode, 'offline')
    assert.equal(deriveNetworkMode(false, true).networkMode, 'lan_only')
    assert.equal(deriveNetworkMode(false, false).networkMode, 'public')
    assert.equal(deriveNetworkMode(true, true).networkMode, 'offline')
    assert.ok(deriveNetworkMode(true, true).warning)
  })

  it('round-trips structured fields through serialize and parse', () => {
    const fields = {
      networkMode: 'public' as const,
      clusterName: 'Test Room',
      clusterDescription: 'Hello world',
      clusterPassword: 'secret',
      gameMode: 'survival' as const,
      maxPlayers: 8,
      pvp: true,
      pauseWhenEmpty: false,
      voteEnabled: true,
      clusterIntention: 'cooperative' as const,
      tickRate: 20,
      maxSnapshots: 6,
      shardEnabled: true,
      bindIp: '127.0.0.1',
      masterIp: '127.0.0.1',
      masterPort: 10888,
      clusterKey: 'myshardkey',
      steamGroupOnly: false,
      steamGroupId: '3614161',
      steamGroupAdmins: false,
    }
    const content = buildClusterIni(fields)
    const parsed = parseClusterIni(content)
    assert.equal(parsed.fields.networkMode, 'public')
    assert.equal(parsed.fields.clusterName, 'Test Room')
    assert.equal(parsed.fields.maxPlayers, 8)
    assert.equal(parsed.fields.pvp, true)
    assert.equal(parsed.fields.shardEnabled, true)
    assert.equal(parsed.fields.masterPort, 10888)
    assert.equal(parsed.fields.clusterKey, 'myshardkey')
    assert.equal(parsed.fields.steamGroupId, '3614161')
    assert.match(content, /steam_group_id = 3614161/)
    assert.match(content, /cluster_key = myshardkey/)
    assert.match(content, /offline_cluster = false/)
    assert.match(content, /lan_only_cluster = false/)
  })

  it('writes sections in reference file order', () => {
    const content = buildClusterIni({
      networkMode: 'offline',
      clusterName: 'Room',
      clusterDescription: '',
      clusterPassword: '',
      gameMode: 'survival',
      maxPlayers: 6,
      pvp: false,
      pauseWhenEmpty: true,
      voteEnabled: true,
      clusterIntention: 'cooperative',
      tickRate: 15,
      maxSnapshots: 6,
      shardEnabled: false,
      bindIp: '127.0.0.1',
      masterIp: '127.0.0.1',
      masterPort: 10888,
      clusterKey: 'supersecretkey',
      steamGroupOnly: false,
      steamGroupId: '0',
      steamGroupAdmins: false,
    })
    const gameplayIndex = content.indexOf('[GAMEPLAY]')
    const networkIndex = content.indexOf('[NETWORK]')
    const miscIndex = content.indexOf('[MISC]')
    const shardIndex = content.indexOf('[SHARD]')
    const steamIndex = content.indexOf('[STEAM]')
    assert.ok(gameplayIndex < networkIndex)
    assert.ok(networkIndex < miscIndex)
    assert.ok(miscIndex < shardIndex)
    assert.ok(shardIndex < steamIndex)
  })

  it('rejects invalid max players', () => {
    const errors = validateClusterFields({
      networkMode: 'offline',
      clusterName: 'Room',
      clusterDescription: '',
      clusterPassword: '',
      gameMode: 'survival',
      maxPlayers: 0,
      pvp: false,
      pauseWhenEmpty: true,
      voteEnabled: true,
      clusterIntention: 'cooperative',
      tickRate: 15,
      maxSnapshots: 6,
      shardEnabled: false,
      bindIp: '127.0.0.1',
      masterIp: '127.0.0.1',
      masterPort: 10888,
      clusterKey: 'supersecretkey',
      steamGroupOnly: false,
      steamGroupId: '0',
      steamGroupAdmins: false,
    })
    assert.ok(errors.some(item => item.includes('最大玩家数')))
  })

  it('parses steam_group_id as digit string and defaults empty to 0', () => {
    const content = buildClusterIni({
      networkMode: 'offline',
      clusterName: 'Room',
      clusterDescription: '',
      clusterPassword: '',
      gameMode: 'survival',
      maxPlayers: 6,
      pvp: false,
      pauseWhenEmpty: true,
      voteEnabled: true,
      clusterIntention: 'cooperative',
      tickRate: 15,
      maxSnapshots: 6,
      shardEnabled: false,
      bindIp: '127.0.0.1',
      masterIp: '127.0.0.1',
      masterPort: 10888,
      clusterKey: 'supersecretkey',
      steamGroupOnly: false,
      steamGroupId: '',
      steamGroupAdmins: false,
    })
    assert.match(content, /steam_group_id = 0/)
    const parsed = parseClusterIni([
      '[STEAM]',
      'steam_group_only = false',
      'steam_group_id = 103582791458',
      'steam_group_admins = false',
      '',
    ].join('\n'))
    assert.equal(parsed.fields.steamGroupId, '103582791458')
  })

  it('normalizes conflicting offline and lan flags on parse', () => {
    const content = [
      '[NETWORK]',
      'cluster_name = Room',
      'offline_cluster = true',
      'lan_only_cluster = true',
      '',
      '[GAMEPLAY]',
      'game_mode = survival',
      'max_players = 6',
      'pvp = false',
      'pause_when_empty = true',
      '',
      '[SHARD]',
      'shard_enabled = false',
      '',
    ].join('\n')
    const parsed = parseClusterIni(content)
    assert.equal(parsed.fields.networkMode, 'offline')
    assert.ok(parsed.warnings.length > 0)
  })

  it('parses and serializes easy and darkandwildernes game modes', () => {
    for (const gameMode of ['easy', 'darkandwildernes'] as const) {
      const content = buildClusterIni({
        networkMode: 'offline',
        clusterName: 'Room',
        clusterDescription: '',
        clusterPassword: '',
        gameMode,
        maxPlayers: 6,
        pvp: false,
        pauseWhenEmpty: true,
        voteEnabled: true,
        clusterIntention: 'cooperative',
        tickRate: 15,
        maxSnapshots: 6,
        shardEnabled: false,
        bindIp: '127.0.0.1',
        masterIp: '127.0.0.1',
        masterPort: 10888,
        clusterKey: 'key',
        steamGroupOnly: false,
        steamGroupId: '0',
        steamGroupAdmins: false,
      })
      assert.ok(content.includes(`game_mode = ${gameMode}`))
      assert.equal(parseClusterIni(content).fields.gameMode, gameMode)
    }
  })
})

describe('cluster-token', () => {
  it('validates pds token format', () => {
    assert.equal(validateClusterToken('pds-abc12345'), undefined)
    assert.equal(validateClusterToken('pds-g^KU_Mjned0Ap^iEZm3bPUVuIUkGboA0FsnshWHDyir5rk7496M5QGmkM='), undefined)
    assert.ok(validateClusterToken('invalid'))
    assert.ok(validateClusterToken(''))
    assert.ok(validateClusterToken('pds-token with spaces'))
  })

  it('masks token without exposing full value', () => {
    const token = 'pds-abcdefghijklmnop'
    const masked = maskClusterToken(token)
    assert.match(masked, /^pds-\*\*\*\*/)
    assert.ok(!masked.includes('abcdefghijklmnop'))
    assert.ok(masked.endsWith('mnop'))
  })

  it('normalizes multiline paste to first line', () => {
    assert.equal(normalizeClusterToken('pds-abc12345\nextra line'), 'pds-abc12345')
  })
})
