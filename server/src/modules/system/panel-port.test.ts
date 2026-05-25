import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveActualPanelPort } from './panel-port'

describe('resolveActualPanelPort', () => {
  it('prefers published port env over server port', () => {
    assert.equal(resolveActualPanelPort({
      serverPort: 3000,
      publishedPortEnv: '9527',
    }), 9527)
  })

  it('uses forwarded port when env is absent', () => {
    assert.equal(resolveActualPanelPort({
      serverPort: 3000,
      forwardedPort: '8080',
    }), 8080)
  })

  it('parses host header port', () => {
    assert.equal(resolveActualPanelPort({
      serverPort: 3000,
      hostHeader: 'localhost:3000',
    }), 3000)
  })

  it('falls back to server port when host has no explicit port', () => {
    assert.equal(resolveActualPanelPort({
      serverPort: 9527,
      hostHeader: 'localhost',
    }), 9527)
  })
})
