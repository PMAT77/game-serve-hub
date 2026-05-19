import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { prepareInstallPathForRuntime, prepareInstallPathForSteamcmd } from './install-path.ts'

describe('prepareInstallPathForSteamcmd', () => {
  it('does not strip executable bit from existing DST binary', () => {
    if (process.platform === 'win32') {
      return
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-install-path-'))
    const installPath = path.join(root, 'instance-a')
    const binDir = path.join(installPath, 'bin64')
    fs.mkdirSync(binDir, { recursive: true })
    const binaryPath = path.join(binDir, 'dontstarve_dedicated_server_nullrenderer_x64')
    fs.writeFileSync(binaryPath, '#!/bin/sh\n')
    fs.chmodSync(binaryPath, 0o755)

    const error = prepareInstallPathForSteamcmd(installPath)
    assert.equal(error, undefined)
    assert.equal(fs.statSync(binaryPath).mode & 0o111, 0o111)

    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe('prepareInstallPathForRuntime', () => {
  it('restores executable bit without recursive chmod', () => {
    if (process.platform === 'win32') {
      return
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-runtime-path-'))
    const installPath = path.join(root, 'instance-b')
    const binDir = path.join(installPath, 'bin64')
    fs.mkdirSync(binDir, { recursive: true })
    const binaryPath = path.join(binDir, 'dontstarve_dedicated_server_nullrenderer_x64')
    fs.writeFileSync(binaryPath, '#!/bin/sh\n')
    fs.chmodSync(binaryPath, 0o664)

    const error = prepareInstallPathForRuntime(installPath)
    assert.equal(error, undefined)
    assert.equal(fs.statSync(binaryPath).mode & 0o111, 0o111)

    fs.rmSync(root, { recursive: true, force: true })
  })
})
