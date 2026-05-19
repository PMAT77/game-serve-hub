import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mapDbInstallLogStatusToResponse,
  shouldAllowInstallDespiteUpToDate,
} from './install-service.ts'

describe('mapDbInstallLogStatusToResponse', () => {
  it('maps installing without log meta to running', () => {
    assert.equal(mapDbInstallLogStatusToResponse(null, 'installing'), 'running')
  })

  it('maps error to failed when log meta unknown', () => {
    assert.equal(mapDbInstallLogStatusToResponse(null, 'error'), 'failed')
  })
})

describe('shouldAllowInstallDespiteUpToDate', () => {
  it('allows force reinstall', () => {
    assert.equal(shouldAllowInstallDespiteUpToDate({
      status: 'stopped',
      gameCode: '343050',
    }, '/var/lib/game-server-hub/instances/x', true), true)
  })

  it('allows error status without force', () => {
    assert.equal(shouldAllowInstallDespiteUpToDate({
      status: 'error',
      gameCode: '343050',
    }, '/var/lib/game-server-hub/instances/x'), true)
  })

  it('allows stopped when game files missing on disk', () => {
    assert.equal(shouldAllowInstallDespiteUpToDate({
      status: 'stopped',
      gameCode: '343050',
    }, '/nonexistent/path/for-gsh-test'), true)
  })
})
