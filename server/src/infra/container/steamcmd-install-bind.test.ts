import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isInstallPathUnderInstancesRoot } from './steamcmd-install-bind.ts'

describe('isInstallPathUnderInstancesRoot', () => {
  it('matches instance directory under instances root', () => {
    const root = '/var/lib/game-server-hub/instances'
    const install = '/var/lib/game-server-hub/instances/f9ab99f7-2dea-4693-acd7-787bb265d07b'
    assert.equal(isInstallPathUnderInstancesRoot(install, root), true)
  })

  it('rejects unrelated paths', () => {
    assert.equal(
      isInstallPathUnderInstancesRoot('/opt/games/dst', '/var/lib/game-server-hub/instances'),
      false,
    )
  })
})
