import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  deleteInstancePath,
  INSTANCE_TEXT_FILE_MAX_BYTES,
  isEditableTextPath,
  isProtectedInstanceFile,
  listInstanceDirectory,
  readInstanceTextFile,
  renameInstancePath,
  resolveInstancePath,
  writeInstanceTextFile,
} from './instance-files'

const tempDirs: string[] = []

function createTempInstanceRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-instance-files-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('instance-files sandbox', () => {
  it('accepts relative paths inside the instance directory', () => {
    const root = createTempInstanceRoot()
    const resolved = resolveInstancePath(root, 'klei-storage/DoNotStarveTogether/Cluster_1/cluster.ini')
    assert.equal(resolved.ok, true)
    assert.equal(
      resolved.ok && resolved.relativePath,
      'klei-storage/DoNotStarveTogether/Cluster_1/cluster.ini',
    )
  })

  it('rejects absolute paths, parent traversal and escaping paths', () => {
    const root = createTempInstanceRoot()
    assert.equal(resolveInstancePath(root, '/etc/passwd').ok, false)
    assert.equal(resolveInstancePath(root, 'C:/Windows/system32').ok, false)
    assert.equal(resolveInstancePath(root, '../outside.txt').ok, false)
    assert.equal(resolveInstancePath(root, 'a/../../outside.txt').ok, false)
    // 空路径只在允许根目录时通过（列目录），读写时要报错
    assert.equal(resolveInstancePath(root, '').ok, false)
    assert.equal(resolveInstancePath(root, '', { allowRoot: true }).ok, true)
  })

  it('rejects a symlink that points outside the instance directory', () => {
    const root = createTempInstanceRoot()
    const outsideDir = createTempInstanceRoot()
    fs.writeFileSync(path.join(outsideDir, 'secret.ini'), 'x', 'utf8')
    // junction 在 Windows 上无需管理员权限，在 Linux 上按普通目录符号链接创建
    fs.symlinkSync(outsideDir, path.join(root, 'escape'), 'junction')

    const resolved = resolveInstancePath(root, 'escape/secret.ini')
    assert.equal(resolved.ok, false)
    assert.match(resolved.ok ? '' : resolved.message, /超出实例目录范围/)
  })

  it('hides symlinked entries from directory listings', () => {
    const root = createTempInstanceRoot()
    const outsideDir = createTempInstanceRoot()
    fs.symlinkSync(outsideDir, path.join(root, 'escape'), 'junction')
    fs.mkdirSync(path.join(root, 'instances'))
    fs.writeFileSync(path.join(root, 'cluster.ini'), '[NETWORK]', 'utf8')

    const entries = listInstanceDirectory(root, '')
    assert.deepEqual(entries.map(item => item.name), ['instances', 'cluster.ini'])
    assert.equal(entries[0]!.type, 'directory')
    assert.equal(entries[1]!.type, 'file')
    assert.equal(entries[1]!.sizeBytes, 9)
    assert.ok(entries[1]!.modifiedAt.length > 0)
  })

  it('marks the cluster token as protected but still lists it', () => {
    const root = createTempInstanceRoot()
    fs.mkdirSync(path.join(root, 'DoNotStarveTogether', 'Cluster_1'), { recursive: true })
    fs.writeFileSync(path.join(root, 'DoNotStarveTogether', 'Cluster_1', 'cluster_token.txt'), 'pds-secret', 'utf8')

    const entries = listInstanceDirectory(root, 'DoNotStarveTogether/Cluster_1')
    const token = entries.find(item => item.name === 'cluster_token.txt')
    assert.ok(token)
    assert.equal(token.protected, true)
    assert.equal(isProtectedInstanceFile('DoNotStarveTogether/Cluster_1/cluster_token.txt'), true)
    assert.equal(isProtectedInstanceFile('Cluster_1/cluster.ini'), false)
  })

  it('reads text files and refuses protected or non-text files', () => {
    const root = createTempInstanceRoot()
    fs.writeFileSync(path.join(root, 'cluster.ini'), '[NETWORK]\ncluster_name = Test\n', 'utf8')
    fs.writeFileSync(path.join(root, 'cluster_token.txt'), 'pds-secret', 'utf8')
    fs.writeFileSync(path.join(root, 'server'), Buffer.from([0x7F, 0x45, 0x4C, 0x46]))

    const file = readInstanceTextFile(root, 'cluster.ini')
    assert.match(file.content, /cluster_name = Test/)
    assert.equal(file.truncated, false)
    assert.equal(file.editable, true)

    assert.throws(() => readInstanceTextFile(root, 'cluster_token.txt'), /敏感信息/)
    assert.throws(() => readInstanceTextFile(root, 'server'), /不支持在面板中编辑/)
  })

  it('flags oversized text files as truncated instead of loading everything', () => {
    const root = createTempInstanceRoot()
    const bigPath = path.join(root, 'chat.log')
    fs.writeFileSync(bigPath, 'a'.repeat(INSTANCE_TEXT_FILE_MAX_BYTES + 16), 'utf8')

    const file = readInstanceTextFile(root, 'chat.log')
    assert.equal(file.truncated, true)
    assert.equal(file.sizeBytes, INSTANCE_TEXT_FILE_MAX_BYTES + 16)
    assert.equal(Buffer.byteLength(file.content, 'utf8'), INSTANCE_TEXT_FILE_MAX_BYTES)
  })

  it('writes text files with a backup of the previous content', () => {
    const root = createTempInstanceRoot()
    fs.writeFileSync(path.join(root, 'cluster.ini'), 'old', 'utf8')

    const result = writeInstanceTextFile(root, 'cluster.ini', 'new content')
    assert.equal(result.sizeBytes, Buffer.byteLength('new content', 'utf8'))
    assert.equal(fs.readFileSync(path.join(root, 'cluster.ini'), 'utf8'), 'new content')
    const backups = fs.readdirSync(root).filter(name => name.startsWith('cluster.ini.bak.'))
    assert.equal(backups.length, 1)

    // 允许新建文本文件（例如缺失的配置文件），但不允许新建二进制类型
    assert.equal(writeInstanceTextFile(root, 'nest/new.ini', '[MISC]').sizeBytes, 6)
    assert.throws(() => writeInstanceTextFile(root, 'binary.bin', 'x'), /不支持在面板中编辑/)
  })

  it('refuses to write protected files or oversized content', () => {
    const root = createTempInstanceRoot()
    fs.writeFileSync(path.join(root, 'cluster_token.txt'), 'pds-secret', 'utf8')
    assert.throws(() => writeInstanceTextFile(root, 'cluster_token.txt', 'hacked'), /敏感信息/)
    assert.throws(
      () => writeInstanceTextFile(root, 'cluster.ini', 'a'.repeat(INSTANCE_TEXT_FILE_MAX_BYTES + 1)),
      /上限/,
    )
    assert.equal(fs.readFileSync(path.join(root, 'cluster_token.txt'), 'utf8'), 'pds-secret')
  })

  it('deletes files and directories but never protected files', () => {
    const root = createTempInstanceRoot()
    fs.mkdirSync(path.join(root, 'logs', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(root, 'logs', 'nested', 'a.txt'), 'x', 'utf8')
    fs.writeFileSync(path.join(root, 'cluster_token.txt'), 'pds-secret', 'utf8')

    assert.equal(deleteInstancePath(root, 'logs').removed, true)
    assert.equal(fs.existsSync(path.join(root, 'logs')), false)
    assert.equal(deleteInstancePath(root, 'missing.txt').removed, false)
    assert.throws(() => deleteInstancePath(root, 'cluster_token.txt'), /敏感信息/)
    assert.throws(() => deleteInstancePath(root, ''), /请指定实例目录内的文件或目录/)
  })

  it('renames inside the same directory and refuses unsafe targets', () => {
    const root = createTempInstanceRoot()
    fs.writeFileSync(path.join(root, 'cluster.ini'), 'x', 'utf8')
    fs.writeFileSync(path.join(root, 'other.ini'), 'y', 'utf8')

    const renamed = renameInstancePath(root, 'cluster.ini', 'cluster.ini.bak')
    assert.equal(renamed.path, 'cluster.ini.bak')
    assert.equal(fs.existsSync(path.join(root, 'cluster.ini.bak')), true)

    assert.throws(() => renameInstancePath(root, 'other.ini', 'sub/other.ini'), /新名称不合法/)
    assert.throws(() => renameInstancePath(root, 'other.ini', 'cluster.ini.bak'), /同名文件已存在/)
    assert.throws(() => renameInstancePath(root, 'other.ini', 'cluster_token.txt'), /敏感文件名/)
  })

  it('only allows known text extensions to be edited', () => {
    assert.equal(isEditableTextPath('cluster.ini'), true)
    assert.equal(isEditableTextPath('worldgenoverride.lua'), true)
    assert.equal(isEditableTextPath('server'), false)
    assert.equal(isEditableTextPath('modinfo.chs'), false)
  })
})
