import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveCorsOrigin } from './index'

describe('resolveCorsOrigin', () => {
  it('allows any origin in development by default', () => {
    assert.equal(resolveCorsOrigin('development', undefined), true)
  })

  it('disables cross-origin reflection in production by default', () => {
    assert.equal(resolveCorsOrigin('production', undefined), false)
  })

  it('parses comma-separated whitelist', () => {
    assert.deepEqual(
      resolveCorsOrigin('production', 'https://a.example.com, https://b.example.com'),
      ['https://a.example.com', 'https://b.example.com'],
    )
  })
})
