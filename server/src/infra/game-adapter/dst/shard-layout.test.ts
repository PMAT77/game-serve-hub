import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { ensureDstClusterConfig } from './cluster-config'
import { isCavesShardConfigured, isShardWorldGenerated, resolveShardSaveDir } from './shard-layout'

const tempDirs: string[] = []

function makeTempInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-shard-layout-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('shard-layout', () => {
  it('reports caves not configured until server.ini exists', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    assert.equal(isCavesShardConfigured(installPath), false)
  })

  it('isShardWorldGenerated is false without save dir', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    assert.equal(isShardWorldGenerated(installPath, 'master'), false)
  })

  it('isShardWorldGenerated is true when save dir has files', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    const saveDir = resolveShardSaveDir(installPath, 'master')
    fs.mkdirSync(saveDir, { recursive: true })
    fs.writeFileSync(path.join(saveDir, 'session'), '1')
    assert.equal(isShardWorldGenerated(installPath, 'master'), true)
  })
})
