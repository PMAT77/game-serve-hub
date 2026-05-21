import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { diagnoseDstInstallReadiness } from './install-readiness'

describe('diagnoseDstInstallReadiness', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeTempInstallDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-install-ready-'))
    tempDirs.push(dir)
    return dir
  }

  it('rejects binary-only install without data directory', () => {
    const installPath = makeTempInstallDir()
    fs.mkdirSync(path.join(installPath, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'bin', 'dontstarve_dedicated_server_nullrenderer'), 'bin')

    const result = diagnoseDstInstallReadiness(installPath)
    assert.equal(result.ready, false)
    assert.equal(result.code, 'missing_game_data')
  })

  it('accepts install when binary and non-empty data exist', () => {
    const installPath = makeTempInstallDir()
    fs.mkdirSync(path.join(installPath, 'bin'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'bin', 'dontstarve_dedicated_server_nullrenderer'), 'bin')
    fs.mkdirSync(path.join(installPath, 'data', 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(installPath, 'data', 'scripts', 'main.lua'), '-- game')

    const result = diagnoseDstInstallReadiness(installPath)
    assert.equal(result.ready, true)
    assert.equal(result.code, 'ok')
  })
})
