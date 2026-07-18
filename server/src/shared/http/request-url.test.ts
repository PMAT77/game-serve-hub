import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeRequestUrlForLog } from './request-url'

describe('sanitizeRequestUrlForLog', () => {
  it('redacts query-string credentials while retaining diagnostic parameters', () => {
    const url = sanitizeRequestUrlForLog('/app/instance/console/stream?instanceId=demo&streamTicket=abc&token=secret')

    assert.equal(url, '/app/instance/console/stream?instanceId=demo&streamTicket=%5BREDACTED%5D&token=%5BREDACTED%5D')
  })

  it('keeps ordinary request URLs unchanged', () => {
    assert.equal(
      sanitizeRequestUrlForLog('/app/instance/console/logs?instanceId=demo&afterId=10'),
      '/app/instance/console/logs?instanceId=demo&afterId=10',
    )
  })
})
