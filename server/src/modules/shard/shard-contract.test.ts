import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  shardInstanceQuerySchema,
  shardSavePayloadSchema,
} from '../../../../shared/contracts/shard'

const validMasterPayload = {
  instanceId: 'instance-1',
  shard: 'master',
  serverPort: 10999,
  steamAuthPort: 8766,
  steamMasterPort: 27016,
  worldgenPreset: 'SURVIVAL_TOGETHER',
  worldRuleOverrides: {
    monsters: 'more',
  },
}

describe('shard API contracts', () => {
  it('normalizes instance queries', () => {
    assert.deepEqual(shardInstanceQuerySchema.parse({
      instanceId: ' instance-1 ',
    }), {
      instanceId: 'instance-1',
    })
  })

  it('accepts valid shard settings', () => {
    assert.equal(shardSavePayloadSchema.safeParse(validMasterPayload).success, true)
    assert.equal(shardSavePayloadSchema.safeParse({
      ...validMasterPayload,
      shard: 'caves',
      serverPort: 11000,
      steamAuthPort: 8768,
      steamMasterPort: 27018,
      worldgenPreset: 'DST_CAVE',
    }).success, true)
  })

  it('rejects incompatible presets and unsafe overrides', () => {
    assert.equal(shardSavePayloadSchema.safeParse({
      ...validMasterPayload,
      worldgenPreset: 'DST_CAVE',
    }).success, false)
    assert.equal(shardSavePayloadSchema.safeParse({
      ...validMasterPayload,
      worldRuleOverrides: { 'invalid-key': 'more' },
    }).success, false)
  })

  it('accepts omitted, cleared and numeric world seeds, rejects anything else', () => {
    // 省略 = 不变更；null = 清除；数字串 = 指定种子
    assert.equal(shardSavePayloadSchema.safeParse(validMasterPayload).success, true)
    assert.equal(shardSavePayloadSchema.safeParse({ ...validMasterPayload, worldSeed: null }).success, true)
    assert.equal(shardSavePayloadSchema.safeParse({ ...validMasterPayload, worldSeed: '1608382646' }).success, true)
    assert.equal(shardSavePayloadSchema.safeParse({ ...validMasterPayload, worldSeed: '0' }).success, true)

    for (const worldSeed of ['', '12a', '1.5', '-1', '1'.repeat(16), ' 123']) {
      assert.equal(
        shardSavePayloadSchema.safeParse({ ...validMasterPayload, worldSeed }).success,
        false,
        `worldSeed 应被拒绝：${JSON.stringify(worldSeed)}`,
      )
    }
  })
})
