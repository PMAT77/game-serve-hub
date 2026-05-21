import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveSteamcmdLoginMode } from './steamcmd-login-mode.ts'

describe('resolveSteamcmdLoginMode', () => {
  it('uses anonymous for DST 343050', () => {
    assert.equal(resolveSteamcmdLoginMode('343050'), 'anonymous')
  })

  it('defaults unknown games to account-fallback', () => {
    assert.equal(resolveSteamcmdLoginMode('380870'), 'account-fallback')
  })
})
