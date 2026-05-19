import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSteamcmdAppUpdateFailureMessage,
  sanitizeSteamcmdLogLine,
} from './steamcmd-errors.ts'

describe('sanitizeSteamcmdLogLine', () => {
  it('strips docker multiplex control bytes', () => {
    assert.equal(sanitizeSteamcmdLogLine('\u0001ERROR! test'), 'ERROR! test')
  })

  it('strips ANSI SGR sequences', () => {
    assert.equal(
      sanitizeSteamcmdLogLine('\u001B[0mSuccess! App \'343050\' fully installed.'),
      'Success! App \'343050\' fully installed.',
    )
  })

  it('strips orphaned [0m after ESC was removed as control char', () => {
    assert.equal(
      sanitizeSteamcmdLogLine('[0m Update state (0x61) downloading, progress: 50.50 (1 / 2)'),
      'Update state (0x61) downloading, progress: 50.50 (1 / 2)',
    )
  })

  it('preserves SteamCMD percent brackets', () => {
    assert.equal(
      sanitizeSteamcmdLogLine('[  0%] Downloading update...'),
      '[ 0%] Downloading update...',
    )
  })

  it('joins tokens split by inline reset codes', () => {
    assert.equal(
      sanitizeSteamcmdLogLine('Connecting anonymously to Steam Public...[0mOK'),
      'Connecting anonymously to Steam Public...OK',
    )
  })
})

describe('formatSteamcmdAppUpdateFailureMessage', () => {
  it('explains DST anonymous Missing configuration', () => {
    const message = formatSteamcmdAppUpdateFailureMessage({
      appId: '343050',
      output: 'ERROR! Failed to install app \'343050\' (Missing configuration)',
      mode: 'anonymous',
      hasAccountCredentials: false,
    })
    assert.match(message, /STEAMCMD_USERNAME/)
    assert.match(message, /免费/)
  })

  it('explains DST anonymous Missing file permissions', () => {
    const message = formatSteamcmdAppUpdateFailureMessage({
      appId: '343050',
      output: 'ERROR! Failed to install app \'343050\' (Missing file permissions)',
      mode: 'anonymous',
      hasAccountCredentials: false,
    })
    assert.match(message, /STEAMCMD_USERNAME/)
  })
})
