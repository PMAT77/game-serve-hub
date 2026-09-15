import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isBinaryResponse, parseBinaryErrorPayload } from './binary-response'

/** 业务信封：拦截器只对这类响应做 status / error 解读 */
const businessEnvelope = { status: 1, data: { ok: true } }

describe('isBinaryResponse', () => {
  // 回归：下载日志 / 备份 / 实例文件时 data 是 Blob，被当业务响应解读会触发登出
  it('responseType 为 blob 且响应体是 Blob 时判定为二进制下载', () => {
    assert.equal(isBinaryResponse({ responseType: 'blob' }, new Blob(['log line'])), true)
  })

  it('responseType 为 blob 时按配置判定，与响应体内容无关', () => {
    assert.equal(isBinaryResponse({ responseType: 'blob' }, businessEnvelope), true)
  })

  it('responseType 为 arraybuffer 时同样判定为二进制下载', () => {
    assert.equal(isBinaryResponse({ responseType: 'arraybuffer' }, new ArrayBuffer(8)), true)
  })

  it('未回填 responseType 但响应体已是 Blob 时兜底判定', () => {
    assert.equal(isBinaryResponse(undefined, new Blob([])), true)
    assert.equal(isBinaryResponse({}, new Blob([])), true)
  })

  it('普通 JSON 接口不受影响', () => {
    assert.equal(isBinaryResponse({ responseType: 'json' }, businessEnvelope), false)
    assert.equal(isBinaryResponse(undefined, businessEnvelope), false)
    assert.equal(isBinaryResponse({}, { status: 0, error: '登录状态失效' }), false)
  })

  it('responseType 为 text 时不走二进制分支', () => {
    assert.equal(isBinaryResponse({ responseType: 'text' }, 'plain text'), false)
  })

  it('响应体为空或非对象时不抛异常', () => {
    assert.equal(isBinaryResponse({ responseType: 'json' }, null), false)
    assert.equal(isBinaryResponse({ responseType: 'json' }, undefined), false)
    assert.equal(isBinaryResponse({ responseType: 'json' }, 'text'), false)
    assert.equal(isBinaryResponse(undefined, 0), false)
  })
})

describe('parseBinaryErrorPayload', () => {
  const envelope = {
    status: 1,
    error: '还没有可下载的日志，实例启动过一次后才会生成',
    code: 'COMMON_BUSINESS_RULE_VIOLATION',
    data: {},
  }

  // 回归：下载失败时中文原因曾被 Response Blob 吞掉，界面只剩 status code
  it('从 Blob 里读回被包成二进制的业务信封', async () => {
    const parsed = await parseBinaryErrorPayload(new Blob([JSON.stringify(envelope)], { type: 'application/json' }))
    assert.equal(parsed?.error, envelope.error)
    assert.equal(parsed?.code, envelope.code)
  })

  it('未授权的业务信封同样能读回', async () => {
    const parsed = await parseBinaryErrorPayload(new Blob([JSON.stringify({ status: 0, error: '登录状态失效，请重新登录', code: 'AUTH_UNAUTHORIZED' })]))
    assert.equal(parsed?.code, 'AUTH_UNAUTHORIZED')
  })

  it('响应体已是文本时直接解析', async () => {
    const parsed = await parseBinaryErrorPayload(JSON.stringify(envelope))
    assert.equal(parsed?.error, envelope.error)
  })

  it('不是 JSON 时返回 undefined，交给通用错误提示', async () => {
    assert.equal(await parseBinaryErrorPayload(new Blob(['<html>502 Bad Gateway</html>'])), undefined)
    assert.equal(await parseBinaryErrorPayload(new Blob([])), undefined)
  })

  it('非二进制响应体不当作业务信封解析', async () => {
    assert.equal(await parseBinaryErrorPayload({ status: 1, error: '已经解析过的对象' }), undefined)
    assert.equal(await parseBinaryErrorPayload(null), undefined)
    assert.equal(await parseBinaryErrorPayload(undefined), undefined)
  })

  it('JSON 顶层是数组时不算业务信封', async () => {
    assert.equal(await parseBinaryErrorPayload(new Blob(['[1,2,3]'])), undefined)
  })
})
