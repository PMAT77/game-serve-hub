import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isIpTrusted, resolveClientIp } from './client-ip.ts'

describe('isIpTrusted', () => {
  it('空列表时一律不可信', () => {
    assert.equal(isIpTrusted('127.0.0.1', []), false)
  })

  it('精确 IPv4/IPv6 匹配', () => {
    assert.equal(isIpTrusted('127.0.0.1', ['127.0.0.1']), true)
    assert.equal(isIpTrusted('::1', ['::1']), true)
    assert.equal(isIpTrusted('127.0.0.2', ['127.0.0.1']), false)
  })

  it('IPv4 CIDR 匹配', () => {
    assert.equal(isIpTrusted('10.1.2.3', ['10.0.0.0/8']), true)
    assert.equal(isIpTrusted('11.1.2.3', ['10.0.0.0/8']), false)
    assert.equal(isIpTrusted('192.168.1.77', ['192.168.1.0/24']), true)
    assert.equal(isIpTrusted('192.168.2.77', ['192.168.1.0/24']), false)
    assert.equal(isIpTrusted('0.0.0.0', ['0.0.0.0/0']), true)
  })

  it('非法 CIDR 不匹配', () => {
    assert.equal(isIpTrusted('10.0.0.1', ['10.0.0.0/33']), false)
    assert.equal(isIpTrusted('::1', ['::1/64']), false)
  })
})

describe('resolveClientIp', () => {
  const request = (ip: string, headers: Record<string, string>) => ({ ip, headers })

  it('未配置可信代理时忽略 XFF，返回 socket 地址', () => {
    const req = request('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' })
    assert.equal(resolveClientIp(req, []), '203.0.113.9')
  })

  it('对端不可信时忽略 XFF', () => {
    const req = request('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' })
    assert.equal(resolveClientIp(req, ['10.0.0.0/8']), '203.0.113.9')
  })

  it('对端可信时取 XFF 第一跳', () => {
    const req = request('127.0.0.1', { 'x-forwarded-for': '198.51.100.7, 10.0.0.2' })
    assert.equal(resolveClientIp(req, ['127.0.0.1']), '198.51.100.7')
  })

  it('对端可信但无 XFF 时回退 socket 地址', () => {
    const req = request('127.0.0.1', {})
    assert.equal(resolveClientIp(req, ['127.0.0.1']), '127.0.0.1')
  })
})
