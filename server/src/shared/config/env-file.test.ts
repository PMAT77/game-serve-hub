import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseEnvFile } from './env-file'

describe('parseEnvFile', () => {
  it('parses whitespace, exports and quoted values', () => {
    assert.deepEqual(parseEnvFile(`
      # comment
      SERVER_PORT = 9527
      export ADMIN_USERNAME=admin
      ADMIN_PASSWORD="a strong password"
      EMPTY =
    `), {
      SERVER_PORT: '9527',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'a strong password',
      EMPTY: '',
    })
  })

  it('removes unquoted inline comments without truncating quoted values', () => {
    assert.deepEqual(parseEnvFile(`
      LOG_LEVEL=debug # local only
      HASHED="value # retained"
    `), {
      LOG_LEVEL: 'debug',
      HASHED: 'value # retained',
    })
  })
})
