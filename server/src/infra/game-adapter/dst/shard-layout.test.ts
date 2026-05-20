import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { isCavesShardConfigured, resolveCavesServerIniPath } from './shard-layout'

const tempDirs: string[] = []

function createTempInstallDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-shard-'))
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
    const installPath = createTempInstallDir()
    assert.equal(isCavesShardConfigured(installPath), false)
    const cavesIni = resolveCavesServerIniPath(installPath)
    fs.mkdirSync(path.dirname(cavesIni), { recursive: true })
    fs.writeFileSync(cavesIni, '[NETWORK]\n', 'utf8')
    assert.equal(isCavesShardConfigured(installPath), true)
  })
})
