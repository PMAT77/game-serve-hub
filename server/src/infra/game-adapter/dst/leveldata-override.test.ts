import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  isValidLeveldataStructure,
  loadLeveldataTemplate,
  mergeLeveldataOverrides,
  parseLeveldataOverrides,
  repairInvalidLeveldataOverrideFile,
  validateWorldRuleOverrides,
} from './leveldata-override'
import { ensureDstClusterConfig } from './cluster-config'
import { resolveShardLeveldataPath } from './shard-layout'

const sampleLua = loadLeveldataTemplate('master')

describe('leveldata-override', () => {
  it('parseLeveldataOverrides reads overrides from official template', () => {
    const overrides = parseLeveldataOverrides(sampleLua)
    assert.equal(overrides.krampus, 'default')
    assert.equal(overrides.branching, 'default')
  })

  it('mergeLeveldataOverrides patches existing official template', () => {
    const merged = mergeLeveldataOverrides(sampleLua, { krampus: 'often' }, 'master')
    const overrides = parseLeveldataOverrides(merged)
    assert.equal(overrides.krampus, 'often')
    assert.equal(overrides.branching, 'default')
    assert.ok(isValidLeveldataStructure(merged))
    assert.match(merged, /id="SURVIVAL_TOGETHER"/)
  })

  it('mergeLeveldataOverrides creates valid master file from template when missing', () => {
    const content = mergeLeveldataOverrides(null, { day: 'longer' }, 'master')
    assert.match(content, /id="SURVIVAL_TOGETHER"/)
    assert.match(content, /location="forest"/)
    const overrides = parseLeveldataOverrides(content)
    assert.equal(overrides.day, 'longer')
    assert.ok(isValidLeveldataStructure(content))
  })

  it('repairs legacy minimal leveldata file', () => {
    const installPath = fs.mkdtempSync(path.join(fs.realpathSync('.'), 'gsh-leveldata-'))
    try {
      ensureDstClusterConfig(installPath, { gamePort: 10999 })
      const luaPath = resolveShardLeveldataPath(installPath, 'master')
      fs.writeFileSync(luaPath, [
        'return {',
        '  overrides={',
        '    krampus="often",',
        '  },',
        '  location="forest",',
        '  version=4,',
        '}',
        '',
      ].join('\n'), 'utf8')
      assert.equal(repairInvalidLeveldataOverrideFile(installPath, 'master'), true)
      const repaired = fs.readFileSync(luaPath, 'utf8')
      assert.ok(isValidLeveldataStructure(repaired))
      assert.equal(parseLeveldataOverrides(repaired).krampus, 'often')
    }
    finally {
      fs.rmSync(installPath, { recursive: true, force: true })
    }
  })

  it('validateWorldRuleOverrides rejects invalid keys', () => {
    assert.match(
      validateWorldRuleOverrides({ 'bad-key': 'default' }) ?? '',
      /键名无效/,
    )
  })
})
