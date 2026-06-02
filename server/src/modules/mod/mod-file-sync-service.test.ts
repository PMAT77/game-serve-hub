import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { DbInstanceMod } from '../../shared/db/index'
import {
  resetModFileSyncDbHooksForTest,
  setModFileSyncDbHooksForTest,
  syncInstanceModFilesFromDb,
} from './mod-file-sync-service'

const tempDirs: string[] = []

function createMockMod(partial: Partial<DbInstanceMod> & Pick<DbInstanceMod, 'workshopId'>): DbInstanceMod {
  const now = new Date().toISOString()
  return {
    id: partial.id ?? `mod-${partial.workshopId}`,
    instanceId: partial.instanceId ?? 'inst-1',
    workshopId: partial.workshopId,
    name: partial.name ?? `Mod ${partial.workshopId}`,
    previewImage: partial.previewImage ?? null,
    enabled: partial.enabled ?? true,
    loadOrder: partial.loadOrder ?? 0,
    version: partial.version ?? null,
    installStatus: partial.installStatus ?? 'ready',
    installError: partial.installError ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  }
}

afterEach(() => {
  resetModFileSyncDbHooksForTest()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('syncInstanceModFilesFromDb', () => {
  it('writes lua setup only for ready mods', async () => {
    const installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-mod-sync-'))
    tempDirs.push(installPath)
    setModFileSyncDbHooksForTest({
      listReadyInstanceMods: async () => [
        createMockMod({ workshopId: '111', enabled: true, loadOrder: 0, installStatus: 'ready' }),
      ],
    })

    await syncInstanceModFilesFromDb('inst-1', installPath)

    const setupPath = path.join(installPath, 'mods', 'dedicated_server_mods_setup.lua')
    assert.equal(fs.existsSync(setupPath), true)
    const content = fs.readFileSync(setupPath, 'utf8')
    assert.match(content, /111/)
    assert.doesNotMatch(content, /222/)
  })

  it('skips when install path is missing', async () => {
    let called = false
    setModFileSyncDbHooksForTest({
      listReadyInstanceMods: async () => {
        called = true
        return []
      },
    })
    await syncInstanceModFilesFromDb('inst-1', '/nonexistent/path')
    assert.equal(called, false)
  })
})
