import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { DST_CLUSTER_NAME, DST_CONF_DIR, DST_STORAGE_DIR, resolveDstSteamWorkshopModDir } from './constants'
import {
  ensureDstUgcModLayout,
  isDstUgcModReady,
  resolveDstUgcModDir,
  resolveDstUgcShardFolders,
  resolveDstWorkshopModSource,
} from './ugc-mod-install'

const tempDirs: string[] = []

function createInstallPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-ugc-mod-'))
  tempDirs.push(dir)
  return dir
}

/** 模拟新式创意工坊下载：steamapps/workshop/content/<appid>/<id>/ 内含 modinfo.lua */
function writeSteamappsSource(installPath: string, workshopId: string) {
  const modDir = resolveDstSteamWorkshopModDir(installPath, workshopId)
  fs.mkdirSync(modDir, { recursive: true })
  fs.writeFileSync(path.join(modDir, 'modinfo.lua'), `name = "Mod ${workshopId}"\n`)
  fs.writeFileSync(path.join(modDir, 'modmain.lua'), '-- main\n')
  return modDir
}

/** 模拟 legacy 创意工坊下载：目录里只有一个 *_legacy.bin（实为标准 zip） */
function writeLegacySource(installPath: string, workshopId: string, fileName = '1665728219799633209_legacy.bin') {
  const modDir = resolveDstSteamWorkshopModDir(installPath, workshopId)
  fs.mkdirSync(modDir, { recursive: true })
  const archive = zipSync({
    'modinfo.lua': strToU8('name = "Legacy Mod"\n'),
    'modmain.lua': strToU8('-- legacy main\n'),
  })
  const archivePath = path.join(modDir, fileName)
  fs.writeFileSync(archivePath, Buffer.from(archive))
  return archivePath
}

function writeCavesShardConfig(installPath: string) {
  const cavesDir = path.join(installPath, DST_STORAGE_DIR, DST_CONF_DIR, DST_CLUSTER_NAME, 'Caves')
  fs.mkdirSync(cavesDir, { recursive: true })
  fs.writeFileSync(path.join(cavesDir, 'server.ini'), '[SHARD]\n')
}

function listTempResidue(installPath: string): string[] {
  const ugcRoot = path.join(installPath, 'ugc_mods')
  if (!fs.existsSync(ugcRoot)) {
    return []
  }
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.includes('.tmp-')) {
          found.push(full)
          continue
        }
        walk(full)
      }
    }
  }
  walk(ugcRoot)
  return found
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveDstUgcShardFolders', () => {
  it('returns master only when caves is not configured', () => {
    const installPath = createInstallPath()
    assert.deepEqual(resolveDstUgcShardFolders(installPath), ['Master'])
  })

  it('returns both shards when caves server.ini exists', () => {
    const installPath = createInstallPath()
    writeCavesShardConfig(installPath)
    assert.deepEqual(resolveDstUgcShardFolders(installPath), ['Master', 'Caves'])
  })
})

describe('resolveDstWorkshopModSource', () => {
  it('prefers the extracted directory over the legacy archive', () => {
    const installPath = createInstallPath()
    writeSteamappsSource(installPath, '111')
    const source = resolveDstWorkshopModSource(installPath, '111')
    assert.equal(source?.kind, 'dir')
  })

  it('falls back to the legacy archive when only *_legacy.bin exists', () => {
    const installPath = createInstallPath()
    const archivePath = writeLegacySource(installPath, '501385076')
    const source = resolveDstWorkshopModSource(installPath, '501385076')
    assert.equal(source?.kind, 'legacy')
    assert.equal(source?.kind === 'legacy' ? source.archivePath : null, archivePath)
  })

  it('falls back to the legacy mods/workshop-<id> layout', () => {
    const installPath = createInstallPath()
    const legacyDir = path.join(installPath, 'mods', 'workshop-222')
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'modinfo.lua'), 'name = "Legacy Dir"\n')
    assert.equal(resolveDstWorkshopModSource(installPath, '222')?.kind, 'dir')
  })

  it('returns null when nothing was downloaded', () => {
    const installPath = createInstallPath()
    assert.equal(resolveDstWorkshopModSource(installPath, '333'), null)
  })
})

describe('ensureDstUgcModLayout', () => {
  it('copies an extracted workshop mod into ugc_mods master content', async () => {
    const installPath = createInstallPath()
    writeSteamappsSource(installPath, '3793502052')

    const outcomes = await ensureDstUgcModLayout(installPath, ['3793502052'])

    assert.deepEqual(outcomes, [{ workshopId: '3793502052', status: 'installed' }])
    const targetDir = resolveDstUgcModDir(installPath, 'Master', '3793502052')
    assert.equal(fs.existsSync(path.join(targetDir, 'modinfo.lua')), true)
    assert.equal(fs.existsSync(path.join(targetDir, 'modmain.lua')), true)
    assert.equal(isDstUgcModReady(installPath, '3793502052'), true)
    assert.deepEqual(listTempResidue(installPath), [])
  })

  it('unpacks a legacy *_legacy.bin archive into a loadable mod directory', async () => {
    const installPath = createInstallPath()
    const archivePath = writeLegacySource(installPath, '501385076')

    const outcomes = await ensureDstUgcModLayout(installPath, ['501385076'])

    assert.deepEqual(outcomes, [{ workshopId: '501385076', status: 'installed' }])
    const targetDir = resolveDstUgcModDir(installPath, 'Master', '501385076')
    assert.equal(fs.readFileSync(path.join(targetDir, 'modinfo.lua'), 'utf8').includes('Legacy Mod'), true)
    // 目标目录内不应残留未解包的压缩包
    assert.deepEqual(fs.readdirSync(targetDir).filter(name => name.endsWith('_legacy.bin')), [])
    // 源压缩包保持不动
    assert.equal(fs.existsSync(archivePath), true)
    assert.deepEqual(listTempResidue(installPath), [])
  })

  it('is idempotent and skips mods that DST already installed', async () => {
    const installPath = createInstallPath()
    writeSteamappsSource(installPath, '111')
    await ensureDstUgcModLayout(installPath, ['111'])

    const targetDir = resolveDstUgcModDir(installPath, 'Master', '111')
    const markerBefore = fs.statSync(path.join(targetDir, 'modinfo.lua')).mtimeMs

    const outcomes = await ensureDstUgcModLayout(installPath, ['111'])

    assert.deepEqual(outcomes, [{ workshopId: '111', status: 'skipped' }])
    assert.equal(fs.statSync(path.join(targetDir, 'modinfo.lua')).mtimeMs, markerBefore)
  })

  it('rebuilds a broken target directory that has no modinfo.lua', async () => {
    const installPath = createInstallPath()
    writeSteamappsSource(installPath, '444')
    const targetDir = resolveDstUgcModDir(installPath, 'Master', '444')
    fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'leftover.txt'), 'broken')

    const outcomes = await ensureDstUgcModLayout(installPath, ['444'])

    assert.deepEqual(outcomes, [{ workshopId: '444', status: 'installed' }])
    assert.equal(fs.existsSync(path.join(targetDir, 'modinfo.lua')), true)
    assert.equal(fs.existsSync(path.join(targetDir, 'leftover.txt')), false)
  })

  it('installs into both shards when caves is configured', async () => {
    const installPath = createInstallPath()
    writeCavesShardConfig(installPath)
    writeSteamappsSource(installPath, '555')

    await ensureDstUgcModLayout(installPath, ['555'])

    assert.equal(isDstUgcModReady(installPath, '555'), true)
    assert.equal(fs.existsSync(path.join(resolveDstUgcModDir(installPath, 'Caves', '555'), 'modinfo.lua')), true)
  })

  it('reports a failure with the searched paths when nothing was downloaded', async () => {
    const installPath = createInstallPath()

    const outcomes = await ensureDstUgcModLayout(installPath, ['666'])

    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].status, 'failed')
    assert.match(outcomes[0].error ?? '', /未找到已下载的 Mod 文件/)
    assert.match(outcomes[0].error ?? '', /steamapps/)
    assert.equal(isDstUgcModReady(installPath, '666'), false)
  })

  it('rejects a corrupt legacy archive, cleaning up and leaving no target dir', async () => {
    const installPath = createInstallPath()
    const modDir = resolveDstSteamWorkshopModDir(installPath, '777')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, '123_legacy.bin'), Buffer.from('not a zip'))

    const outcomes = await ensureDstUgcModLayout(installPath, ['777'])

    assert.equal(outcomes[0].status, 'failed')
    assert.equal(fs.existsSync(resolveDstUgcModDir(installPath, 'Master', '777')), false)
    assert.deepEqual(listTempResidue(installPath), [])
  })

  it('rejects a legacy archive that tries to escape the target directory', async () => {
    const installPath = createInstallPath()
    const modDir = resolveDstSteamWorkshopModDir(installPath, '888')
    fs.mkdirSync(modDir, { recursive: true })
    const evilArchive = zipSync({
      '../escaped.lua': strToU8('-- escaped\n'),
      'modinfo.lua': strToU8('name = "Evil"\n'),
    })
    fs.writeFileSync(path.join(modDir, '999_legacy.bin'), Buffer.from(evilArchive))

    const outcomes = await ensureDstUgcModLayout(installPath, ['888'])

    assert.equal(outcomes[0].status, 'failed')
    assert.equal(fs.existsSync(path.join(installPath, 'escaped.lua')), false)
    assert.equal(fs.existsSync(path.join(path.dirname(installPath), 'escaped.lua')), false)
    assert.deepEqual(listTempResidue(installPath), [])
  })

  it('reports a failure when the install path is missing', async () => {
    const outcomes = await ensureDstUgcModLayout('/nonexistent/gsh-install-path', ['999'])
    assert.equal(outcomes[0].status, 'failed')
    assert.match(outcomes[0].error ?? '', /安装目录不存在/)
  })

  it('ignores blank and duplicated workshop ids', async () => {
    const installPath = createInstallPath()
    writeSteamappsSource(installPath, '1010')

    const outcomes = await ensureDstUgcModLayout(installPath, ['1010', ' 1010 ', ''])

    assert.deepEqual(outcomes, [{ workshopId: '1010', status: 'installed' }])
    assert.deepEqual(await ensureDstUgcModLayout(installPath, []), [])
  })
})
