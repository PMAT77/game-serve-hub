import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifySteamcmdInstallFailure,
  formatSteamcmdAppUpdateFailureMessage,
  isRetriableSteamcmdInstallOutput,
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

  it('preserves SteamCMD percent brackets', () => {
    assert.equal(
      sanitizeSteamcmdLogLine('[  0%] Downloading update...'),
      '[ 0%] Downloading update...',
    )
  })
})

describe('classifySteamcmdInstallFailure', () => {
  it('treats needs to be online as network', () => {
    assert.equal(
      classifySteamcmdInstallFailure('Fatal Error: Steamcmd needs to be online to update'),
      'network',
    )
  })

  it('treats Missing configuration as network (transient Steam)', () => {
    assert.equal(
      classifySteamcmdInstallFailure('ERROR! Failed to install app \'343050\' (Missing configuration)'),
      'network',
    )
  })

  it('treats 0x602 as network', () => {
    assert.equal(
      classifySteamcmdInstallFailure('Error! App \'343050\' state is 0x602 after update job'),
      'network',
    )
  })
})

describe('formatSteamcmdAppUpdateFailureMessage', () => {
  it('explains Missing configuration as network instability', () => {
    const message = formatSteamcmdAppUpdateFailureMessage({
      appId: '343050',
      output: 'ERROR! Failed to install app \'343050\' (Missing configuration)',
      mode: 'anonymous',
      hasAccountCredentials: false,
    })
    assert.match(message, /网络或 Steam 服务不稳定/)
    assert.match(message, /GSH_STEAMCMD_DOWNLOAD_REGION=cn/)
    assert.doesNotMatch(message, /bind/)
    assert.doesNotMatch(message, /STEAMCMD_USERNAME/)
  })

  it('explains Missing file permissions as mount permission issue', () => {
    const message = formatSteamcmdAppUpdateFailureMessage({
      appId: '343050',
      output: 'ERROR! Failed to install app \'343050\' (Missing file permissions)',
      mode: 'anonymous',
      hasAccountCredentials: false,
    })
    assert.match(message, /Missing file permissions/)
    assert.match(message, /GSH_STEAMCMD_RUN_USER/)
  })

  it('explains No subscription for account-only games', () => {
    const message = formatSteamcmdAppUpdateFailureMessage({
      appId: '380870',
      output: 'ERROR! Failed to install app \'380870\' (No subscription)',
      mode: 'anonymous',
      hasAccountCredentials: false,
    })
    assert.match(message, /No subscription/)
    assert.match(message, /STEAMCMD_USERNAME/)
  })
})

describe('isRetriableSteamcmdInstallOutput', () => {
  it('retries network-class failures only', () => {
    assert.equal(isRetriableSteamcmdInstallOutput('Missing configuration'), true)
    assert.equal(isRetriableSteamcmdInstallOutput('Missing file permissions'), false)
    assert.equal(isRetriableSteamcmdInstallOutput('No subscription'), false)
  })
})
