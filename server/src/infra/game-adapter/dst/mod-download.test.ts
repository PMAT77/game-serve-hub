import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { buildSteamcmdWorkshopDownloadArgs } from '../../container/steamcmd-args'
import { DST_CLUSTER_NAME, DST_WORKSHOP_APP_ID } from './constants'
import {
  collectMissingWorkshopIds,
  formatModDownloadFailureMessage,
  isDstWorkshopModPresent,
  resolveDstSteamWorkshopModDir,
} from './mod-download'

const tempDirs: string[] = []

function createInstallPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-mod-download-'))
  tempDirs.push(dir)
  return dir
}

function writeModMarker(installPath: string, workshopId: string, location: 'steamapps' | 'ugc-master') {
  const modDir = location === 'steamapps'
    ? resolveDstSteamWorkshopModDir(installPath, workshopId)
    : path.join(
        installPath,
        'ugc_mods',
        DST_CLUSTER_NAME,
        'Master',
        'content',
        DST_WORKSHOP_APP_ID,
        workshopId,
      )
  fs.mkdirSync(modDir, { recursive: true })
  fs.writeFileSync(path.join(modDir, 'modinfo.lua'), 'name = "Test Mod"\n')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('mod-download', () => {
  it('detects workshop mod in steamapps path', () => {
    const installPath = createInstallPath()
    writeModMarker(installPath, '12345', 'steamapps')
    assert.equal(isDstWorkshopModPresent(installPath, '12345'), true)
    assert.equal(isDstWorkshopModPresent(installPath, '99999'), false)
  })

  it('detects workshop mod in ugc_mods master path', () => {
    const installPath = createInstallPath()
    writeModMarker(installPath, '67890', 'ugc-master')
    assert.equal(isDstWorkshopModPresent(installPath, '67890'), true)
  })

  it('detects V2 workshop download via legacy.bin', () => {
    const installPath = createInstallPath()
    const modDir = resolveDstSteamWorkshopModDir(installPath, '501385076')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, '1665728219799633209_legacy.bin'), Buffer.from('legacy'))
    assert.equal(isDstWorkshopModPresent(installPath, '501385076'), true)
  })

  it('detects V1 workshop download via mod.manifest', () => {
    const installPath = createInstallPath()
    const modDir = resolveDstSteamWorkshopModDir(installPath, '2074508776')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, 'mod.manifest'), 'manifest')
    assert.equal(isDstWorkshopModPresent(installPath, '2074508776'), true)
  })

  it('collects only missing workshop ids', () => {
    const installPath = createInstallPath()
    writeModMarker(installPath, '111', 'steamapps')
    assert.deepEqual(
      collectMissingWorkshopIds(installPath, ['111', '222', '222']),
      ['222'],
    )
  })

  it('formats common download failure messages', () => {
    assert.match(formatModDownloadFailureMessage('Connection timed out'), /超时/)
    assert.match(formatModDownloadFailureMessage('Access Denied'), /无法下载/)
    assert.match(formatModDownloadFailureMessage('Missing file permissions'), /权限/)
    assert.match(formatModDownloadFailureMessage(''), /网络/)
  })
})

describe('buildSteamcmdWorkshopDownloadArgs', () => {
  it('places force_install_dir before login and chains workshop downloads', () => {
    const args = buildSteamcmdWorkshopDownloadArgs(
      '/game',
      DST_WORKSHOP_APP_ID,
      ['111', '222'],
      ['+login', 'anonymous'],
    )
    const forceIdx = args.indexOf('+force_install_dir')
    const loginIdx = args.indexOf('+login')
    const firstDownloadIdx = args.indexOf('+workshop_download_item')
    assert.ok(forceIdx >= 0)
    assert.ok(loginIdx >= 0)
    assert.ok(firstDownloadIdx >= 0)
    assert.ok(forceIdx < loginIdx)
    assert.ok(loginIdx < firstDownloadIdx)
    assert.equal(args[forceIdx + 1], '/game')
    assert.equal(args.filter(item => item === '+workshop_download_item').length, 2)
    assert.deepEqual(args.slice(firstDownloadIdx, firstDownloadIdx + 4), [
      '+workshop_download_item',
      DST_WORKSHOP_APP_ID,
      '111',
      'validate',
    ])
    assert.ok(args.includes('+quit'))
  })
})
