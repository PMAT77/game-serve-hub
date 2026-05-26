import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerAuthModule } from './index'
import { initDatabase } from '../../shared/db/index'

interface ApiEnvelope<T> {
  status: 0 | 1
  error: string
  code: string
  data: T
}

interface LoginData {
  account: string
  token: string
  refreshToken: string
}

const dbFilePath = path.join(os.tmpdir(), `gsh-auth-api-test-${randomUUID()}.sqlite`)
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle')

let app: FastifyInstance

function parseBody<T>(body: string): ApiEnvelope<T> {
  return JSON.parse(body) as ApiEnvelope<T>
}

describe('auth api token lifecycle', () => {
  before(async () => {
    await initDatabase(dbFilePath, migrationsFolder)
    app = Fastify({
      logger: false,
    })
    registerAuthModule(app)
    await app.ready()
  })

  after(async () => {
    await app.close()
  })

  it('supports login -> refresh -> old refresh invalid', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/app/account/login',
      payload: {
        account: 'superadmin',
        password: '123456',
      },
    })
    assert.equal(loginResponse.statusCode, 200)
    const loginBody = parseBody<LoginData>(loginResponse.body)
    assert.equal(loginBody.status, 1)
    assert.ok(loginBody.data.token)
    assert.ok(loginBody.data.refreshToken)

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/app/account/token/refresh',
      payload: {
        refreshToken: loginBody.data.refreshToken,
      },
    })
    assert.equal(refreshResponse.statusCode, 200)
    const refreshBody = parseBody<LoginData>(refreshResponse.body)
    assert.equal(refreshBody.status, 1)
    assert.ok(refreshBody.data.token)
    assert.ok(refreshBody.data.refreshToken)
    assert.notEqual(refreshBody.data.refreshToken, loginBody.data.refreshToken)

    const replayResponse = await app.inject({
      method: 'POST',
      url: '/app/account/token/refresh',
      payload: {
        refreshToken: loginBody.data.refreshToken,
      },
    })
    assert.equal(replayResponse.statusCode, 200)
    const replayBody = parseBody<Record<string, never>>(replayResponse.body)
    assert.equal(replayBody.status, 0)
    assert.equal(replayBody.code, 'AUTH_UNAUTHORIZED')
  })

  it('revokes both access and refresh tokens on logout', async () => {
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

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/app/account/logout',
      headers: {
        token: loginBody.data.token,
      },
      payload: {
        refreshToken: loginBody.data.refreshToken,
      },
    })
    assert.equal(logoutResponse.statusCode, 200)
    const logoutBody = parseBody<{ isSuccess: boolean }>(logoutResponse.body)
    assert.equal(logoutBody.status, 1)
    assert.equal(logoutBody.data.isSuccess, true)

    const permissionResponse = await app.inject({
      method: 'GET',
      url: '/app/account/permission',
      headers: {
        token: loginBody.data.token,
      },
    })
    const permissionBody = parseBody<Record<string, never>>(permissionResponse.body)
    assert.equal(permissionBody.status, 0)
    assert.equal(permissionBody.code, 'AUTH_UNAUTHORIZED')

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/app/account/token/refresh',
      payload: {
        refreshToken: loginBody.data.refreshToken,
      },
    })
    const refreshBody = parseBody<Record<string, never>>(refreshResponse.body)
    assert.equal(refreshBody.status, 0)
    assert.equal(refreshBody.code, 'AUTH_UNAUTHORIZED')
  })
})
