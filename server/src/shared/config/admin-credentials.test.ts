import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadServerConfig } from './index'

describe('admin credentials in production', () => {
  it('generates a strong random password when ADMIN_PASSWORD is unset', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousAdminPassword = process.env.ADMIN_PASSWORD
    const previousAdminUsername = process.env.ADMIN_USERNAME
    process.env.NODE_ENV = 'production'
    delete process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_USERNAME

    try {
      const config = loadServerConfig()
      assert.equal(config.adminPasswordGenerated, true)
      assert.match(config.adminPassword, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/)
      assert.equal(config.adminUsername, 'superadmin')
    }
    finally {
      process.env.NODE_ENV = previousNodeEnv
      if (previousAdminPassword === undefined) {
        delete process.env.ADMIN_PASSWORD
      }
      else {
        process.env.ADMIN_PASSWORD = previousAdminPassword
      }
      if (previousAdminUsername === undefined) {
        delete process.env.ADMIN_USERNAME
      }
      else {
        process.env.ADMIN_USERNAME = previousAdminUsername
      }
    }
  })
})
