import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loginBodySchema,
  passwordEditBodySchema,
  passwordRecoverBodySchema,
  refreshTokenBodySchema,
} from '../../../../shared/contracts/auth'

describe('auth API contracts', () => {
  it('normalizes account identifiers without changing secrets', () => {
    assert.deepEqual(loginBodySchema.parse({
      account: ' superadmin ',
      password: ' pass word ',
      remember: true,
    }), {
      account: 'superadmin',
      password: ' pass word ',
      remember: true,
    })
  })

  it('rejects malformed token and password payloads', () => {
    assert.equal(refreshTokenBodySchema.safeParse({
      refreshToken: ' ',
    }).success, false)
    assert.equal(passwordEditBodySchema.safeParse({
      password: '',
      newPassword: 'NewPassword1!',
    }).success, false)
    assert.equal(passwordRecoverBodySchema.safeParse({
      account: 'superadmin',
      recoveryToken: 'recovery-token',
      newPassword: '',
    }).success, false)
  })
})
