import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clearDstConnectHostCache, isPublicIpv4, resolveDstConnectHost } from './connect-host'

describe('connect-host', () => {
  it('isPublicIpv4 rejects RFC1918 and loopback', () => {
    assert.equal(isPublicIpv4('203.0.113.10'), true)
    assert.equal(isPublicIpv4('192.168.1.1'), false)
    assert.equal(isPublicIpv4('10.0.0.1'), false)
    assert.equal(isPublicIpv4('127.0.0.1'), false)
    assert.equal(isPublicIpv4('172.16.0.1'), false)
  })

  it('resolveDstConnectHost prefers GSH_DST_CONNECT_HOST', async () => {
    const previous = process.env.GSH_DST_CONNECT_HOST
    process.env.GSH_DST_CONNECT_HOST = '203.0.113.55'
    clearDstConnectHostCache()
    try {
      const resolved = await resolveDstConnectHost()
      assert.equal(resolved.host, '203.0.113.55')
      assert.equal(resolved.source, 'env')
      assert.equal(resolved.isPlaceholder, false)
    }
    finally {
      clearDstConnectHostCache()
      if (previous === undefined) {
        delete process.env.GSH_DST_CONNECT_HOST
      }
      else {
        process.env.GSH_DST_CONNECT_HOST = previous
      }
    }
  })
})
