import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUDIT_OUTCOME_META, formatAuditParams, formatAuditTime } from './auditDisplay'

/**
 * 审计展示口径。
 *
 * 插件调用记录与面板操作记录共用这套映射与格式化——两处各写一份时，
 * 「被拒」的配色与参数摘要的形状就会各自漂移，这里把它们钉住。
 */

describe('审计结果标签', () => {
  it('三种结果都有中文标签', () => {
    assert.equal(AUDIT_OUTCOME_META.ok.label, '成功')
    assert.equal(AUDIT_OUTCOME_META.denied.label, '被拒')
    assert.equal(AUDIT_OUTCOME_META.error.label, '失败')
  })

  it('被拒用 warning 而不是 default：越权尝试需要管理员看一眼', () => {
    assert.equal(AUDIT_OUTCOME_META.denied.type, 'warning')
    assert.equal(AUDIT_OUTCOME_META.error.type, 'error')
    assert.equal(AUDIT_OUTCOME_META.ok.type, 'success')
  })
})

describe('参数摘要', () => {
  it('跳过 pluginId——同一行已经显示过插件名', () => {
    assert.equal(formatAuditParams({ pluginId: 'audit-log' }), '')
  })

  it('没有可显示的参数时返回空串，界面据此少显示一行', () => {
    assert.equal(formatAuditParams({}), '')
  })

  it('按「键=值」拼接，多个参数用全角空格分隔', () => {
    assert.equal(formatAuditParams({ instanceId: 'abc', force: true }), 'instanceId=abc　force=true')
  })
})

describe('时间格式', () => {
  it('解析不出来时原样显示，不显示 Invalid Date', () => {
    assert.equal(formatAuditTime('not-a-time'), 'not-a-time')
  })

  it('合法时间戳转成可读时间', () => {
    const formatted = formatAuditTime('2026-09-22T10:00:00.000Z')
    assert.ok(formatted.length > 0)
    assert.notEqual(formatted, '2026-09-22T10:00:00.000Z')
    assert.ok(!formatted.includes('Invalid'))
  })
})
