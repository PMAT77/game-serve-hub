import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mapDtoSchema,
  mapImageQuerySchema,
  mapLegendEntrySchema,
  mapQuerySchema,
  mapRefreshPayloadSchema,
  mapStatusSchema,
} from '../../../../shared/contracts/map'

describe('map contracts', () => {
  it('查询与刷新请求接受合法参数', () => {
    assert.equal(mapQuerySchema.safeParse({ instanceId: 'instance-1', shard: 'master' }).success, true)
    assert.equal(mapQuerySchema.safeParse({ instanceId: 'instance-1', shard: 'caves' }).success, true)
    assert.equal(mapRefreshPayloadSchema.safeParse({
      instanceId: 'instance-1',
      shard: 'master',
    }).success, true)
    assert.equal(mapRefreshPayloadSchema.safeParse({
      instanceId: 'instance-1',
      shard: 'master',
      force: true,
    }).success, true)
    assert.equal(mapImageQuerySchema.safeParse({ instanceId: 'instance-1', shard: 'master' }).success, true)
  })

  it('拒绝非法分片与缺失实例 ID', () => {
    assert.equal(mapQuerySchema.safeParse({ instanceId: 'instance-1', shard: 'overworld' }).success, false)
    assert.equal(mapQuerySchema.safeParse({ shard: 'master' }).success, false)
    assert.equal(mapRefreshPayloadSchema.safeParse({ instanceId: 'instance-1', shard: 'master', force: 'yes' }).success, false)
  })

  it('状态枚举只有四个值', () => {
    for (const status of ['idle', 'generating', 'ready', 'failed']) {
      assert.equal(mapStatusSchema.safeParse(status).success, true)
    }
    assert.equal(mapStatusSchema.safeParse('queued').success, false)
    assert.equal(mapStatusSchema.safeParse('').success, false)
  })

  it('图例项：颜色必须是 #rrggbb，地标的占比为 null', () => {
    assert.equal(mapLegendEntrySchema.safeParse({
      key: 'terrain:7',
      kind: 'terrain',
      label: '森林',
      color: '#446e3e',
      shape: null,
      count: 15269,
      ratio: 0.084,
      known: true,
    }).success, true)
    assert.equal(mapLegendEntrySchema.safeParse({
      key: 'landmark:pigking',
      kind: 'landmark',
      label: '猪王',
      color: '#ffd54f',
      shape: 'square',
      count: 1,
      ratio: null,
      known: true,
    }).success, true)
    // 没收录的地块：名字来自游戏，颜色是按 ID 派生的，known=false 让界面能标出来
    assert.equal(mapLegendEntrySchema.safeParse({
      key: 'terrain:263',
      kind: 'terrain',
      label: 'Ice Floe（未收录）',
      color: '#5fb0d0',
      shape: null,
      count: 12,
      ratio: 0.0001,
      known: false,
    }).success, true)
    // 颜色写错格式会让前端把它当成非法 CSS，静默渲染成透明色块
    assert.equal(mapLegendEntrySchema.safeParse({
      key: 'terrain:7',
      kind: 'terrain',
      label: '森林',
      color: 'green',
      shape: null,
      count: 1,
      ratio: 0.1,
      known: true,
    }).success, false)
    assert.equal(mapLegendEntrySchema.safeParse({
      key: 'terrain:7',
      kind: 'terrain',
      label: '森林',
      color: '#446e3e',
      shape: null,
      count: -1,
      ratio: 0.1,
      known: true,
    }).success, false)
    assert.equal(mapLegendEntrySchema.safeParse({
      key: 'terrain:7',
      kind: 'terrain',
      label: '',
      color: '#446e3e',
      shape: null,
      count: 1,
      ratio: 0.1,
      known: true,
    }).success, false)
  })

  it('没有图时状态与字段自洽：imagePath 必须为 null', () => {
    const idle = mapDtoSchema.parse({
      instanceId: 'instance-1',
      shard: 'master',
      status: 'idle',
      exportedAt: null,
      imagePath: null,
      width: null,
      height: null,
      renderScale: null,
      seed: null,
      landmarkCount: null,
      legend: [],
      filledRatio: null,
      ageSeconds: null,
      message: '还没有这个分片的地形图',
    })
    assert.equal(idle.imagePath, null)
    assert.equal(idle.status, 'idle')
    assert.deepEqual(idle.legend, [])
  })

  it('有图时接受完整字段（含图例与地标数）', () => {
    const ready = mapDtoSchema.parse({
      instanceId: 'instance-1',
      shard: 'master',
      status: 'ready',
      exportedAt: '2026-09-20T12:00:00.000Z',
      imagePath: 'app/instance/map/image?instanceId=instance-1&shard=master',
      width: 425,
      height: 425,
      renderScale: 3,
      seed: '1608382646',
      landmarkCount: 12,
      legend: [
        { key: 'terrain:203', kind: 'terrain', label: '涌浪海域', color: '#18427a', shape: null, count: 42769, ratio: 0.237, known: true },
        { key: 'landmark:pigking', kind: 'landmark', label: '猪王', color: '#ffd54f', shape: 'square', count: 1, ratio: null, known: true },
      ],
      filledRatio: 0.87,
      ageSeconds: 12,
      message: null,
    })
    assert.equal(ready.width, 425)
    assert.equal(ready.renderScale, 3)
    assert.equal(ready.landmarkCount, 12)
    assert.equal(ready.legend.length, 2)
  })

  it('占比与时长越界会被拒绝（避免前端拿到不可能的数值）', () => {
    const base = {
      instanceId: 'instance-1',
      shard: 'master',
      status: 'ready',
      exportedAt: null,
      imagePath: null,
      width: null,
      height: null,
      renderScale: null,
      seed: null,
      landmarkCount: null,
      legend: [],
      ageSeconds: null,
      message: null,
    }
    assert.equal(mapDtoSchema.safeParse({ ...base, filledRatio: 1.5 }).success, false)
    assert.equal(mapDtoSchema.safeParse({ ...base, filledRatio: -0.1 }).success, false)
    assert.equal(mapDtoSchema.safeParse({ ...base, ageSeconds: -1 }).success, false)
    assert.equal(mapDtoSchema.safeParse({ ...base, width: 0 }).success, false)
    assert.equal(mapDtoSchema.safeParse({ ...base, renderScale: 0 }).success, false)
    assert.equal(mapDtoSchema.safeParse({ ...base, landmarkCount: -1 }).success, false)
  })
})
