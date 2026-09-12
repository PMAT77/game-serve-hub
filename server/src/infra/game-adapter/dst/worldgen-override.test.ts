import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildWorldgenOverride,
  defaultWorldgenPreset,
  isValidWorldgenPreset,
  parseWorldgenOverride,
  validateWorldgenPreset,
} from './worldgen-override'

describe('worldgen-override', () => {
  it('writes the preset together with every override (single source of truth)', () => {
    const content = buildWorldgenOverride('SURVIVAL_TOGETHER', { krampus: 'often', branching: 'most' })
    assert.match(content, /override_enabled = true/)
    assert.match(content, /preset = "SURVIVAL_TOGETHER"/)
    const parsed = parseWorldgenOverride(content)
    assert.equal(parsed.preset, 'SURVIVAL_TOGETHER')
    assert.deepEqual(parsed.overrides, { branching: 'most', krampus: 'often' })
    assert.deepEqual(parsed.warnings, [])
  })

  it('sorts override keys and writes an empty table when nothing is customized', () => {
    const content = buildWorldgenOverride('DST_CAVE', { world_size: 'small', day: 'longer' })
    assert.ok(content.indexOf('day="longer"') < content.indexOf('world_size="small"'))
    assert.match(buildWorldgenOverride('DST_CAVE'), /overrides = \{\},/)
  })

  it('keeps values with spaces quotable', () => {
    const content = buildWorldgenOverride('SURVIVAL_TOGETHER', { prefabswaps_start: 'highly random' })
    assert.match(content, /prefabswaps_start="highly random",/)
    assert.equal(parseWorldgenOverride(content).overrides.prefabswaps_start, 'highly random')
  })

  it('reads worldgen_preset/settings_preset when preset is absent', () => {
    const content = [
      'return {',
      '  override_enabled = true,',
      '  worldgen_preset = "DST_CAVE",',
      '  settings_preset = "DST_CAVE_PLUS",',
      '  overrides = {',
      '    day="longer",',
      '  },',
      '}',
      '',
    ].join('\n')
    const parsed = parseWorldgenOverride(content)
    assert.equal(parsed.preset, 'DST_CAVE')
    assert.deepEqual(parsed.overrides, { day: 'longer' })
  })

  it('warns when no preset can be recognised', () => {
    const parsed = parseWorldgenOverride('return { override_enabled = true, overrides = {} }')
    assert.equal(parsed.preset, null)
    assert.equal(parsed.warnings.length, 1)
  })

  it('validates presets per shard', () => {
    assert.equal(validateWorldgenPreset('master', 'SURVIVAL_TOGETHER'), null)
    assert.match(validateWorldgenPreset('master', 'DST_CAVE') ?? '', /主世界/)
    assert.equal(validateWorldgenPreset('caves', 'DST_CAVE'), null)
    assert.equal(isValidWorldgenPreset('caves', 'COMPLETE_DARKNESS'), true)
    assert.equal(defaultWorldgenPreset('master'), 'SURVIVAL_TOGETHER')
    assert.equal(defaultWorldgenPreset('caves'), 'DST_CAVE')
  })
})
