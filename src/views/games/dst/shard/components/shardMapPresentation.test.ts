import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MapLegendEntryDto } from '@/api/modules/map'
import {
  describePrimaryAction,
  describeStatus,
  formatAge,
  formatExportedAt,
  formatFilledRatio,
  formatLandmarkCount,
  formatLandmarkSummary,
  formatLegendRatio,
  formatMapSize,
  legendShapeClass,
  shouldPoll,
  splitLegend,
} from './shardMapPresentation'

const legendEntry = (overrides: Partial<MapLegendEntryDto> = {}): MapLegendEntryDto => ({
  key: 'terrain:7',
  kind: 'terrain',
  label: '森林',
  color: '#446e3e',
  shape: null,
  count: 100,
  ratio: 0.5,
  known: true,
  ...overrides,
})

describe('shouldPoll', () => {
  it('只有生成中才继续轮询', () => {
    assert.equal(shouldPoll('generating'), true)
    assert.equal(shouldPoll('ready'), false)
    assert.equal(shouldPoll('failed'), false)
    assert.equal(shouldPoll('idle'), false)
    assert.equal(shouldPoll(undefined), false)
  })
})

describe('formatAge', () => {
  it('刚生成完说"刚刚"，不说"0 秒前"', () => {
    assert.equal(formatAge(0), '刚刚')
    assert.equal(formatAge(3), '刚刚')
    assert.equal(formatAge(9), '刚刚')
  })

  it('按秒 / 分 / 时 / 天分档', () => {
    assert.equal(formatAge(45), '45 秒前')
    assert.equal(formatAge(60), '1 分钟前')
    assert.equal(formatAge(3599), '59 分钟前')
    assert.equal(formatAge(3600), '1 小时前')
    assert.equal(formatAge(86399), '23 小时前')
    assert.equal(formatAge(86400), '1 天前')
  })

  it('无效值返回空串（界面少显示一行，而不是显示怪东西）', () => {
    assert.equal(formatAge(null), '')
    assert.equal(formatAge(undefined), '')
    assert.equal(formatAge(-1), '')
    assert.equal(formatAge(Number.NaN), '')
  })
})

describe('formatExportedAt', () => {
  it('合法时间出来是可读文本', () => {
    const text = formatExportedAt('2026-09-21T12:00:00.000Z')
    assert.equal(text.length > 0, true)
    assert.equal(text.includes('Invalid'), false)
  })

  it('空值与非法时间返回空串', () => {
    assert.equal(formatExportedAt(null), '')
    assert.equal(formatExportedAt(''), '')
    assert.equal(formatExportedAt('not-a-date'), '')
  })
})

describe('formatMapSize', () => {
  it('两个值都有才显示，避免半截字样', () => {
    assert.equal(formatMapSize(425, 425), '425 × 425')
    assert.equal(formatMapSize(425, null), '')
    assert.equal(formatMapSize(null, 425), '')
    assert.equal(formatMapSize(0, 0), '')
  })
})

describe('formatFilledRatio', () => {
  it('0 是合法值，必须能显示（世界刚生成时就是 0）', () => {
    assert.equal(formatFilledRatio(0), '0%')
    assert.equal(formatFilledRatio(0.5), '50%')
    assert.equal(formatFilledRatio(1), '100%')
  })

  it('无效值返回空串', () => {
    assert.equal(formatFilledRatio(null), '')
    assert.equal(formatFilledRatio(undefined), '')
    assert.equal(formatFilledRatio(Number.NaN), '')
  })
})

describe('describeStatus', () => {
  it('每个状态都有文案，idle 不显示标签', () => {
    assert.deepEqual(describeStatus('ready'), { text: '已生成', tone: 'success' })
    assert.deepEqual(describeStatus('generating'), { text: '生成中', tone: 'info' })
    assert.deepEqual(describeStatus('failed'), { text: '生成失败', tone: 'error' })
    assert.deepEqual(describeStatus('idle'), { text: '', tone: null })
    assert.deepEqual(describeStatus(undefined), { text: '', tone: null })
  })
})

describe('describePrimaryAction', () => {
  it('有图时是"重新生成"，没有时是"生成地图"', () => {
    assert.equal(describePrimaryAction(true), '重新生成')
    assert.equal(describePrimaryAction(false), '生成地图')
  })
})

describe('splitLegend', () => {
  it('地形与地标分开，各自保持服务端给的顺序', () => {
    const entries = [
      legendEntry({ key: 'terrain:203', label: '涌浪海域' }),
      legendEntry({ key: 'landmark:pigking', kind: 'landmark', label: '猪王', ratio: null, count: 1 }),
      legendEntry({ key: 'terrain:7', label: '森林' }),
    ]
    const groups = splitLegend(entries)
    assert.deepEqual(groups.terrain.map(entry => entry.key), ['terrain:203', 'terrain:7'])
    assert.deepEqual(groups.landmarks.map(entry => entry.key), ['landmark:pigking'])
  })

  it('空值与 null 都不炸（旧产物没有图例）', () => {
    assert.deepEqual(splitLegend(null), { terrain: [], landmarks: [] })
    assert.deepEqual(splitLegend(undefined), { terrain: [], landmarks: [] })
    assert.deepEqual(splitLegend([]), { terrain: [], landmarks: [] })
  })
})

describe('formatLegendRatio', () => {
  it('保留一位小数', () => {
    assert.equal(formatLegendRatio(0.237), '23.7%')
    assert.equal(formatLegendRatio(0.5), '50.0%')
    assert.equal(formatLegendRatio(0.0845), '8.5%')
  })

  it('极小块写成"小于 0.1%"而不是 0.0%', () => {
    // 真机上确实有只占 0.007% 的地块，写成 0.0% 会被读成"这块地不存在"
    assert.equal(formatLegendRatio(0.00007), '<0.1%')
    assert.equal(formatLegendRatio(0.0009), '<0.1%')
    assert.equal(formatLegendRatio(0.001), '0.1%')
  })

  it('地标项（ratio 为 null）返回空串，而不是 0%', () => {
    assert.equal(formatLegendRatio(null), '')
    assert.equal(formatLegendRatio(undefined), '')
    assert.equal(formatLegendRatio(Number.NaN), '')
  })

  it('占比真的是 0 时如实显示 0%', () => {
    assert.equal(formatLegendRatio(0), '0%')
  })
})

describe('formatLandmarkSummary', () => {
  it('有地标时给出处数', () => {
    assert.equal(formatLandmarkSummary(1), '地标：1 处')
    assert.equal(formatLandmarkSummary(12), '地标：12 处')
  })

  it('没有地标时不显示这一项（而不是"地标：0 处"）', () => {
    assert.equal(formatLandmarkSummary(0), '')
    assert.equal(formatLandmarkSummary(null), '')
    assert.equal(formatLandmarkSummary(undefined), '')
    assert.equal(formatLandmarkSummary(-1), '')
  })
})

describe('legendShapeClass', () => {
  it('形状与图上画的一致：通道圆、建筑方、巢穴菱形', () => {
    assert.equal(legendShapeClass('circle'), 'rounded-full')
    assert.equal(legendShapeClass('square'), 'rounded-sm')
    assert.equal(legendShapeClass('diamond'), 'rotate-45 rounded-[2px]')
  })

  it('地形项（shape 为 null）按方块渲染', () => {
    assert.equal(legendShapeClass(null), 'rounded-sm')
  })
})

describe('formatLandmarkCount', () => {
  it('地标数量带单位', () => {
    assert.equal(formatLandmarkCount(3), '3 处')
  })
})
