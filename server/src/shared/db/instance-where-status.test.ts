import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { closeDatabase, createGameInstance, initDatabase } from './index'
import { updateGameInstanceRuntime } from './instance-repository'

const dbFilePath = path.join(os.tmpdir(), `gsh-where-status-test-${randomUUID()}.sqlite`)
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle')

describe('updateGameInstanceRuntime whereStatus guard', () => {
  before(async () => {
    await initDatabase(dbFilePath, migrationsFolder)
  })

  after(() => {
    closeDatabase()
  })

  it('skips the write when the current status does not match (状态机竞态保护)', async () => {
    const instance = await createGameInstance({
      nodeId: 'local-node',
      name: 'guard-test',
      gameCode: 'dst',
      status: 'stopped',
      installPath: path.join(os.tmpdir(), 'gsh-guard-test'),
    })

    const unchanged = await updateGameInstanceRuntime(instance.id, {
      status: 'error',
      lastError: '不应该被写入',
      whereStatus: 'installing',
    })
    assert.equal(unchanged?.status, 'stopped')
    assert.equal(unchanged?.lastError, null)
  })

  it('applies the write when the current status matches (单值与数组形式)', async () => {
    const instance = await createGameInstance({
      nodeId: 'local-node',
      name: 'guard-test-hit',
      gameCode: 'dst',
      status: 'installing',
      installPath: path.join(os.tmpdir(), 'gsh-guard-test-hit'),
    })

    const single = await updateGameInstanceRuntime(instance.id, {
      status: 'error',
      lastError: '安装失败',
      whereStatus: 'installing',
    })
    assert.equal(single?.status, 'error')
    assert.equal(single?.lastError, '安装失败')

    const multi = await updateGameInstanceRuntime(instance.id, {
      status: 'stopped',
      lastCommand: '安装已完成',
      whereStatus: ['error', 'pending_install'],
    })
    assert.equal(multi?.status, 'stopped')
    assert.equal(multi?.lastCommand, '安装已完成')
  })
})
