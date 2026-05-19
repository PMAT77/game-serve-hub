import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSteamcmdAppUpdateArgs } from './steamcmd-args.ts'

describe('buildSteamcmdAppUpdateArgs', () => {
  it('places force_install_dir before login', () => {
    const args = buildSteamcmdAppUpdateArgs('/game', '343050', ['+login', 'anonymous'])
    const forceIdx = args.indexOf('+force_install_dir')
    const loginIdx = args.indexOf('+login')
    assert.ok(forceIdx >= 0)
    assert.ok(loginIdx >= 0)
    assert.ok(forceIdx < loginIdx, `expected force_install_dir before login, got: ${args.join(' ')}`)
    assert.equal(args[forceIdx + 1], '/game')
  })
})
