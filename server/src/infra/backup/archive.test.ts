import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { createDirectoryArchive, extractArchive, getDirectorySizeBytes, replaceDirectory } from './archive'

let workDir: string

function writeTree(root: string) {
  const saveDir = path.join(root, 'DoNotStarveTogether', 'Cluster_1', 'Master', 'save')
  fs.mkdirSync(saveDir, { recursive: true })
  fs.writeFileSync(path.join(saveDir, 'world.txt'), '世界存档内容-1')
  fs.writeFileSync(path.join(root, 'cluster.ini'), '[gameplay]\nmax_players = 16\n')
  fs.writeFileSync(path.join(root, 'cluster_token.txt'), 'pds-g^n^token')
}

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-archive-test-'))
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('backup archive infra', () => {
  it('archives a directory and restores identical content after source changes', async () => {
    const source = path.join(workDir, 'src-tree')
    writeTree(source)
    const archivePath = path.join(workDir, 'test-backup.tar.gz')

    await createDirectoryArchive(source, archivePath)
    assert.ok(fs.existsSync(archivePath))
    assert.ok(fs.statSync(archivePath).size > 0)

    // 源目录发生变化（模拟存档推进）
    fs.writeFileSync(path.join(source, 'DoNotStarveTogether', 'Cluster_1', 'Master', 'save', 'world.txt'), '世界存档内容-2')
    fs.mkdirSync(path.join(source, 'DoNotStarveTogether', 'Cluster_1', 'Caves', 'save'), { recursive: true })
    fs.writeFileSync(path.join(source, 'DoNotStarveTogether', 'Cluster_1', 'Caves', 'save', 'caves.txt'), '洞穴')

    const restoreDir = path.join(workDir, 'restore-target')
    await extractArchive(archivePath, restoreDir)

    const restoredWorld = path.join(restoreDir, path.basename(source), 'DoNotStarveTogether', 'Cluster_1', 'Master', 'save', 'world.txt')
    assert.equal(fs.readFileSync(restoredWorld, 'utf8'), '世界存档内容-1')
    assert.ok(!fs.existsSync(path.join(restoreDir, path.basename(source), 'DoNotStarveTogether', 'Cluster_1', 'Caves')))
  })

  it('rejects archiving a missing source directory', async () => {
    await assert.rejects(
      () => createDirectoryArchive(path.join(workDir, 'not-exists'), path.join(workDir, 'nope.tar.gz')),
      /待备份目录不存在/,
    )
  })

  it('replaces a directory atomically and cleans up the displaced one', () => {
    const live = path.join(workDir, 'live-dir')
    const prepared = path.join(workDir, 'prepared-dir')
    fs.mkdirSync(live, { recursive: true })
    fs.writeFileSync(path.join(live, 'old.txt'), 'old')
    fs.mkdirSync(prepared, { recursive: true })
    fs.writeFileSync(path.join(prepared, 'new.txt'), 'new')

    replaceDirectory(live, prepared)

    assert.ok(fs.existsSync(path.join(live, 'new.txt')))
    assert.ok(!fs.existsSync(path.join(live, 'old.txt')))
    const displaced = fs.readdirSync(workDir).filter(name => name.startsWith('.replaced-'))
    assert.equal(displaced.length, 0)
  })

  it('rolls back the live directory when the prepared directory is missing', () => {
    const live = path.join(workDir, 'live-dir-2')
    fs.mkdirSync(live, { recursive: true })
    fs.writeFileSync(path.join(live, 'keep.txt'), 'keep')

    assert.throws(
      () => replaceDirectory(live, path.join(workDir, `missing-${randomUUID()}`)),
    )
    assert.ok(fs.existsSync(path.join(live, 'keep.txt')))
  })

  it('computes directory size in bytes', () => {
    const dir = path.join(workDir, 'size-dir')
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a'.repeat(1024))
    fs.writeFileSync(path.join(dir, 'nested', 'b.txt'), 'b'.repeat(2048))
    const size = getDirectorySizeBytes(dir)
    assert.equal(size, 1024 + 2048)
  })
})
