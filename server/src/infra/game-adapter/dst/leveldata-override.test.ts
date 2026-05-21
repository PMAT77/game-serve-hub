import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  mergeLeveldataOverrides,
  parseLeveldataOverrides,
  validateWorldRuleOverrides,
} from './leveldata-override'

const sampleLua = fs.readFileSync(
  path.join(process.cwd(), 'docs/others/master_leveldataoverride.lua'),
  'utf8',
)

describe('leveldata-override', () => {
  it('parseLeveldataOverrides reads overrides from sample file', () => {
    const overrides = parseLeveldataOverrides(sampleLua)
    assert.equal(overrides.ghostenabled, 'always')
    assert.equal(overrides.krampus, 'default')
  })

  it('mergeLeveldataOverrides patches existing file', () => {
    const merged = mergeLeveldataOverrides(sampleLua, { krampus: 'often' }, 'master')
    const overrides = parseLeveldataOverrides(merged)
    assert.equal(overrides.krampus, 'often')
    assert.equal(overrides.ghostenabled, 'always')
  })

  it('mergeLeveldataOverrides creates minimal master file when missing', () => {
    const content = mergeLeveldataOverrides(null, { day: 'longer' }, 'master')
    assert.match(content, /location="forest"/)
    const overrides = parseLeveldataOverrides(content)
    assert.equal(overrides.day, 'longer')
  })

  it('validateWorldRuleOverrides rejects invalid keys', () => {
    assert.match(
      validateWorldRuleOverrides({ 'bad-key': 'default' }) ?? '',
      /键名无效/,
    )
  })
})
