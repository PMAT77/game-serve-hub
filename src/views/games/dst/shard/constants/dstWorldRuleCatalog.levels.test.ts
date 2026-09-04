import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { overrideValueSchema } from '../../../../../../shared/contracts/shard'
import { DST_RULE_LEVEL_PROFILES } from './dstWorldRuleLevels.ts'

describe('dst world rule level values vs shared overrideValueSchema', () => {
  it('every option value of every profile passes overrideValueSchema', () => {
    assert.ok(DST_RULE_LEVEL_PROFILES.length > 0)
    for (const profile of DST_RULE_LEVEL_PROFILES) {
      for (const option of profile.levels) {
        const parsed = overrideValueSchema.safeParse(option.value)
        assert.equal(
          parsed.success,
          true,
          `profile ${profile.id} option ${option.label}(${option.value}) violates overrideValueSchema`,
        )
      }
    }
  })
})
