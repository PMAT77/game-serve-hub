import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { writeInstanceModFiles } from './mod-service'

const tempDirs: string[] = []

function createInstallPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-mod-service-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('mod-service', () => {
  it('writes modoverrides.lua for both master and caves when caves folder is missing', () => {
    const installPath = createInstallPath()
    writeInstanceModFiles(installPath, [
      { workshopId: '111', enabled: true, loadOrder: 1 },
      { workshopId: '222', enabled: false, loadOrder: 0 },
    ])

    const clusterRoot = path.join(installPath, 'klei-storage', 'DoNotStarveTogether', 'Cluster_1')
    const setupPath = path.join(installPath, 'mods', 'dedicated_server_mods_setup.lua')
    const clusterSetupPath = path.join(clusterRoot, 'dedicated_server_mods_setup.lua')
    const masterOverridesPath = path.join(clusterRoot, 'Master', 'modoverrides.lua')
    const cavesOverridesPath = path.join(clusterRoot, 'Caves', 'modoverrides.lua')

    assert.equal(fs.existsSync(setupPath), true)
    assert.equal(fs.existsSync(clusterSetupPath), true)
    assert.equal(fs.existsSync(masterOverridesPath), true)
    assert.equal(fs.existsSync(cavesOverridesPath), true)

    const setupContent = fs.readFileSync(setupPath, 'utf8')
    const masterOverridesContent = fs.readFileSync(masterOverridesPath, 'utf8')
    const cavesOverridesContent = fs.readFileSync(cavesOverridesPath, 'utf8')

    assert.match(setupContent, /ServerModSetup\("111"\)/)
    assert.match(setupContent, /ServerModSetup\("222"\)/)
    assert.match(masterOverridesContent, /\["workshop-111"\]=\{ enabled=true \}/)
    assert.match(masterOverridesContent, /\["workshop-222"\]=\{ enabled=false \}/)
    assert.equal(cavesOverridesContent, masterOverridesContent)
  })
})
