import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { closeDatabase, findUserByAccount, initDatabase, updateUserPassword, verifyPassword } from '../../shared/db/index'

const dbFilePath = path.join(os.tmpdir(), `gsh-seed-admin-test-${randomUUID()}.sqlite`)
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle')

describe('seedAdminUserFromEnv', () => {
  after(() => {
    closeDatabase()
  })

  it('does not overwrite existing admin password on restart unless sync flag is enabled', async () => {
    await initDatabase(dbFilePath, migrationsFolder, {
      adminUsername: 'superadmin',
      adminPassword: '123456',
      seedDevelopmentUsers: false,
    })
    const user = await findUserByAccount('superadmin')
    assert.ok(user)
    await updateUserPassword(user!.id, 'CustomPwd#2026')
    closeDatabase()

    await initDatabase(dbFilePath, migrationsFolder, {
      adminUsername: 'superadmin',
      adminPassword: '123456',
      seedDevelopmentUsers: false,
      syncAdminPasswordFromEnv: false,
    })
    const afterRestart = await findUserByAccount('superadmin')
    assert.ok(afterRestart)
    assert.equal(verifyPassword('CustomPwd#2026', afterRestart!.password_hash), true)
    closeDatabase()

    await initDatabase(dbFilePath, migrationsFolder, {
      adminUsername: 'superadmin',
      adminPassword: '123456',
      seedDevelopmentUsers: false,
      syncAdminPasswordFromEnv: true,
    })
    const afterSync = await findUserByAccount('superadmin')
    assert.ok(afterSync)
    assert.equal(verifyPassword('123456', afterSync!.password_hash), true)
    closeDatabase()
  })
})
