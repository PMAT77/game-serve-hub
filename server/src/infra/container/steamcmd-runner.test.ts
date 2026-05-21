import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { buildSteamcmdAppUpdateArgs } from './steamcmd-args.ts'



describe('buildSteamcmdAppUpdateArgs', () => {

  it('places force_install_dir before login and updates target app only', () => {

    const args = buildSteamcmdAppUpdateArgs('/game', '343050', ['+login', 'anonymous'])

    const forceIdx = args.indexOf('+force_install_dir')

    const loginIdx = args.indexOf('+login')

    const appUpdateIdx = args.indexOf('+app_update')

    assert.ok(forceIdx >= 0)

    assert.ok(loginIdx >= 0)

    assert.ok(appUpdateIdx >= 0)

    assert.ok(forceIdx < loginIdx, `expected force_install_dir before login, got: ${args.join(' ')}`)

    assert.ok(loginIdx < appUpdateIdx, `expected login before app_update, got: ${args.join(' ')}`)

    assert.equal(args[forceIdx + 1], '/game')

    assert.equal(args[appUpdateIdx + 1], '343050')

    assert.equal(args.filter(item => item === '+app_update').length, 1)

    assert.ok(args.includes('linux'))

  })

  it('inserts force region before force_install_dir when configured', () => {
    const args = buildSteamcmdAppUpdateArgs('/game', '343050', ['+login', 'anonymous'], {
      downloadRegion: 'cn',
    })
    const regionIdx = args.indexOf('+@sSteamCmdForceRegion')
    const forceIdx = args.indexOf('+force_install_dir')
    assert.ok(regionIdx >= 0)
    assert.ok(forceIdx >= 0)
    assert.ok(regionIdx < forceIdx)
    assert.equal(args[regionIdx + 1], 'cn')
  })

})


