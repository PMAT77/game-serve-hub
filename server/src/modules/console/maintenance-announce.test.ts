import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMaintenanceAnnounceCommand,
  escapeLuaDoubleQuotedString,
  validateMaintenanceMessage,
} from './maintenance-announce.ts'

describe('escapeLuaDoubleQuotedString', () => {
  it('escapes backslash and double quotes', () => {
    assert.equal(escapeLuaDoubleQuotedString('say "hi" \\ now'), 'say \\"hi\\" \\\\ now')
  })

  it('escapes newlines', () => {
    assert.equal(escapeLuaDoubleQuotedString('line1\nline2'), 'line1\\nline2')
  })
})

describe('buildMaintenanceAnnounceCommand', () => {
  it('builds TheNet:Announce with escaped message', () => {
    assert.equal(
      buildMaintenanceAnnounceCommand('10 分钟后面板升级'),
      'TheNet:Announce("10 分钟后面板升级")',
    )
  })

  it('rejects empty message', () => {
    assert.throws(
      () => buildMaintenanceAnnounceCommand('   '),
      /公告内容不能为空/,
    )
  })
})

describe('validateMaintenanceMessage', () => {
  it('accepts non-empty message within limit', () => {
    assert.equal(validateMaintenanceMessage('hello'), undefined)
  })

  it('rejects empty message', () => {
    assert.equal(validateMaintenanceMessage(''), '公告内容不能为空')
  })
})
