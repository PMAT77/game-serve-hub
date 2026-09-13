import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_API_BASE_URL, resolveApiBaseUrl, withTrailingSlash } from './base-url'

describe('resolveApiBaseUrl', () => {
  it('开发期开启代理时走 Vite 代理前缀', () => {
    assert.equal(resolveApiBaseUrl({ dev: true, proxyEnabled: true, configured: 'http://127.0.0.1:8888' }), '/proxy/')
  })

  it('开发期未开代理时使用显式配置', () => {
    assert.equal(resolveApiBaseUrl({ dev: true, proxyEnabled: false, configured: 'http://127.0.0.1:8888' }), 'http://127.0.0.1:8888')
  })

  it('生产构建未注入变量时兜底为同源根路径', () => {
    assert.equal(resolveApiBaseUrl({ dev: false, proxyEnabled: undefined, configured: undefined }), DEFAULT_API_BASE_URL)
  })

  it('生产构建注入的值为空串时同样兜底', () => {
    assert.equal(resolveApiBaseUrl({ dev: false, proxyEnabled: undefined, configured: '   ' }), DEFAULT_API_BASE_URL)
  })

  it('生产构建注入的值为根路径时原样返回', () => {
    assert.equal(resolveApiBaseUrl({ dev: false, proxyEnabled: undefined, configured: '/' }), '/')
  })

  it('配置值不是字符串时兜底，不退化为隐式转换', () => {
    assert.equal(resolveApiBaseUrl({ dev: false, proxyEnabled: undefined, configured: 0 }), DEFAULT_API_BASE_URL)
  })

  // 回归：曾经因为返回 undefined，调用方直接 .endsWith 抛 TypeError，SSE 静默失效
  it('返回值一定是字符串，可直接调用字符串方法', () => {
    const base = resolveApiBaseUrl({ dev: false, proxyEnabled: undefined, configured: undefined })
    assert.equal(typeof base, 'string')
    assert.doesNotThrow(() => base.endsWith('/'))
  })
})

describe('withTrailingSlash', () => {
  it('缺少尾斜杠时补齐', () => {
    assert.equal(withTrailingSlash('/'), '/')
    assert.equal(withTrailingSlash('http://127.0.0.1:8888'), 'http://127.0.0.1:8888/')
    assert.equal(withTrailingSlash('http://127.0.0.1:8888/'), 'http://127.0.0.1:8888/')
  })
})
