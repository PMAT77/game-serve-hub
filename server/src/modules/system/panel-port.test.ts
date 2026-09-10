import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveActualPanelPort, resolvePanelPortBootstrapSync } from './panel-port'

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

describe('resolvePanelPortBootstrapSync', () => {
  const base = { mode: 'production' as const, defaultPanelPort: 9527 }

  it('skips sync in non-production modes', () => {
    assert.equal(resolvePanelPortBootstrapSync({ ...base, mode: 'development', publishedPortEnv: '8888' }), null)
    assert.equal(resolvePanelPortBootstrapSync({ ...base, mode: 'test', publishedPortEnv: '8888' }), null)
  })

  it('skips sync when published port env is absent or invalid', () => {
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: undefined }), null)
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '' }), null)
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: 'not-a-port' }), null)
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '70000' }), null)
  })

  it('initializes an empty database with the published port', () => {
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '9527' }), 9527)
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '8080' }), 8080)
  })

  it('updates a factory-default panel port to the published port', () => {
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '8080', existingPanelPort: 9527 }), 8080)
  })

  it('keeps factory default when it already matches the published port', () => {
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '9527', existingPanelPort: 9527 }), null)
  })

  it('never overrides an explicit user setting', () => {
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '8080', existingPanelPort: 3000 }), null)
    assert.equal(resolvePanelPortBootstrapSync({ ...base, publishedPortEnv: '9527', existingPanelPort: 8080 }), null)
  })
})
