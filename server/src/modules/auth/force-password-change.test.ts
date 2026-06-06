import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerAuthModule } from './index'
import { registerSystemModule } from '../system/index'
import { initDatabase } from '../../shared/db/index'

interface ApiEnvelope<T> {
  status: 0 | 1
  error: string
  code: string
  data: T
}

interface LoginData {
  token: string
  refreshToken: string
  mustChangePassword?: boolean
}

const dbFilePath = path.join(os.tmpdir(), `gsh-force-pwd-test-${randomUUID()}.sqlite`)
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle')
const NEW_PASSWORD = 'ForcePwd#2026'

let app: FastifyInstance

function parseBody<T>(body: string): ApiEnvelope<T> {
  return JSON.parse(body) as ApiEnvelope<T>
}

describe('force password change flow', () => {
  before(async () => {
    await initDatabase(dbFilePath, migrationsFolder, {
      forcePasswordChange: true,
      adminUsername: 'superadmin',
      adminPassword: '123456',
    })
    app = Fastify({ logger: false })
    registerAuthModule(app)
    registerSystemModule(app)
    await app.ready()
  })

  after(async () => {
    await app.close()
  })

  it('login returns mustChangePassword and blocks protected routes until password edit', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/app/account/login',
      payload: {
        account: 'superadmin',
        password: '123456',
      },
    })
    const loginBody = parseBody<LoginData>(loginResponse.body)
    assert.equal(loginBody.status, 1)
    assert.equal(loginBody.data.mustChangePassword, true)

    const blockedResponse = await app.inject({
      method: 'GET',
      url: '/app/system/info',
      headers: {
        token: loginBody.data.token,
      },
    })
    const blockedBody = parseBody<Record<string, never>>(blockedResponse.body)
    assert.equal(blockedBody.status, 1)
    assert.equal(blockedBody.code, 'AUTH_FORCE_PASSWORD_CHANGE')

    const permissionResponse = await app.inject({
      method: 'GET',
      url: '/app/account/permission',
      headers: {
        token: loginBody.data.token,
      },
    })
    const permissionBody = parseBody<{ mustChangePassword: boolean }>(permissionResponse.body)
    assert.equal(permissionBody.status, 1)
    assert.equal(permissionBody.data.mustChangePassword, true)

    const editResponse = await app.inject({
      method: 'POST',
      url: '/app/account/password/edit',
      headers: {
        token: loginBody.data.token,
      },
      payload: {
        password: '123456',
        newPassword: NEW_PASSWORD,
      },
    })
    const editBody = parseBody<{ isSuccess: boolean, mustChangePassword: boolean }>(editResponse.body)
    assert.equal(editBody.status, 1)
    assert.equal(editBody.data.isSuccess, true)
    assert.equal(editBody.data.mustChangePassword, false)

    const allowedResponse = await app.inject({
      method: 'GET',
      url: '/app/system/info',
      headers: {
        token: loginBody.data.token,
      },
    })
    const allowedBody = parseBody<Record<string, unknown>>(allowedResponse.body)
    assert.equal(allowedBody.status, 1)
  })
})
