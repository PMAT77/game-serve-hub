import type { PluginListItem } from '../../../shared/contracts/plugin'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPluginCard,
  capabilityLabel,
  dangerousCapabilityLabels,
  filterPluginCards,
  groupPluginCards,
  isDangerousCapability,
  isInstalled,
  needsSubscription,
  resolveCardAction,
  summarizePlugins,
} from './pluginStorePresentation'

/**
 * 插件卡片的状态与文案口径。
 *
 * 这一层决定了三件容易出错的事，各有一组用例钉住：
 *   1. 未安装的条目**绝不能**被当成已安装（否则会渲染出开关，点了必然失败）；
 *   2. `planned`（尚未开发）与 `bundled` 一律不给可点的入口——这是对外承诺的底线；
 *   3. 「已订阅但没导入包」要能被单独识别，那是人工交付链路上最常见的中间态。
 */

function makeItem(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: 'pro-demo',
    name: '示例插件',
    version: '1.0.0',
    apiVersion: 1,
    kind: 'commercial',
    state: 'disabled',
    enabled: false,
    message: '',
    capabilities: [],
    hasDangerousCapabilities: false,
    signed: true,
    publisher: 'gsh-official',
    description: null,
    author: null,
    directory: 'pro-demo',
    runtime: {
      state: 'stopped',
      pid: null,
      startedAt: null,
      restarts: 0,
      lastError: null,
    },
    installed: true,
    store: null,
    ...overrides,
  }
}

/** 目录条目的占位形态：接口对未安装插件返回的样子 */
function makeShelfItem(
  accessState: 'obtainable' | 'planned' | 'bundled',
  overrides: Partial<PluginListItem> = {},
  licenseSatisfied = true,
): PluginListItem {
  return makeItem({
    installed: false,
    version: '-',
    directory: '',
    signed: false,
    state: 'disabled',
    store: {
      summary: '把存档备份到别处。',
      detail: '详情',
      access: { state: accessState, label: '标签', detail: '说明' },
      requiredLicense: accessState === 'planned' ? 'multi-node' : 'remote-backup',
      licenseSatisfied,
    },
    ...overrides,
  })
}

describe('能力标签', () => {
  it('已知能力给中文标签，未知能力原样回落到标识', () => {
    assert.equal(capabilityLabel('backups:delete'), '删除备份')
    assert.equal(capabilityLabel('unknown:thing'), 'unknown:thing')
  })

  it('危险能力按固定顺序列出中文名', () => {
    const labels = dangerousCapabilityLabels(['storage:kv', 'backups:delete', 'network:outbound'])
    assert.deepEqual(labels, ['删除备份', '对外联网'])
  })

  it('只读插件没有危险能力', () => {
    assert.deepEqual(dangerousCapabilityLabels(['instances:read', 'metrics:read']), [])
  })

  it('单个能力的危险判定与共享清单一致', () => {
    assert.equal(isDangerousCapability('backups:delete'), true)
    assert.equal(isDangerousCapability('network:outbound'), true)
    assert.equal(isDangerousCapability('backups:read'), false)
    assert.equal(isDangerousCapability('storage:kv'), false)
  })
})

describe('已安装判断', () => {
  it('installed 为 false 才算未安装', () => {
    assert.equal(isInstalled(makeShelfItem('obtainable')), false)
    assert.equal(isInstalled(makeItem()), true)
  })

  it('installed 缺省时按已安装理解——引入商店之前列表里每一项都来自本地目录', () => {
    const legacy = makeItem()
    delete (legacy as { installed?: boolean }).installed
    assert.equal(isInstalled(legacy), true)
  })
})

describe('卡片状态', () => {
  it('未安装且未授权：可订阅，标签是「未获取」', () => {
    const card = buildPluginCard(makeShelfItem('obtainable', {}, false))
    assert.equal(card.tone, 'obtainable')
    assert.equal(card.label, '未获取')
    assert.equal(card.installed, false)
  })

  it('未安装但已有授权：单独识别为「已订阅 · 待导入」', () => {
    // 服务端在缺授权时会给 missing_license；这里没有 message 说明授权已满足
    const item = makeShelfItem('obtainable', { message: '' })
    assert.equal(buildPluginCard(item).tone, 'licensed-not-installed')
    assert.equal(buildPluginCard(item).label, '已订阅 · 待导入')
  })

  it('尚未开发与随面板分发各有自己的状态，不混进可订阅那一类', () => {
    assert.equal(buildPluginCard(makeShelfItem('planned')).tone, 'planned')
    assert.equal(buildPluginCard(makeShelfItem('planned')).label, '尚未开发')
    assert.equal(buildPluginCard(makeShelfItem('bundled')).tone, 'bundled-not-installed')
  })

  it('已安装缺授权：状态是 warning，与「已停用」区分开', () => {
    const card = buildPluginCard(makeItem({ state: 'missing_license' }))
    assert.equal(card.tone, 'missing-license')
    assert.equal(card.type, 'warning')
  })

  it('启用但进程崩了要看得出来，不能显示成一切正常', () => {
    const card = buildPluginCard(makeItem({
      enabled: true,
      state: 'ready',
      runtime: { state: 'crashed', pid: null, startedAt: null, restarts: 3, lastError: '退出码 1' },
    }))
    assert.equal(card.tone, 'crashed')
  })

  it('危险能力在卡片上给出提示', () => {
    const card = buildPluginCard(makeItem({ capabilities: ['backups:delete'] }))
    assert.match(card.dangerHint ?? '', /删除备份/)
  })

  it('产品文案优先用官方目录的说明，其次才是插件自带的描述', () => {
    const withStore = makeShelfItem('obtainable')
    assert.equal(buildPluginCard(withStore).summary, '把存档备份到别处。')
    const withoutStore = makeItem({ description: '插件自己写的说明', store: null })
    assert.equal(buildPluginCard(withoutStore).summary, '插件自己写的说明')
  })
})

describe('卡片操作', () => {
  it('可获取且未授权 → 订阅', () => {
    const action = resolveCardAction(makeShelfItem('obtainable', {}, false))
    assert.equal(action.action, 'subscribe')
    assert.equal(action.label, '订阅')
  })

  it('已安装且缺授权 → 订阅授权（续期与补买的入口）', () => {
    const action = resolveCardAction(makeItem({ state: 'missing_license' }))
    assert.equal(action.action, 'subscribe')
  })

  it('尚未开发 → 没有按钮，只有说明', () => {
    const action = resolveCardAction(makeShelfItem('planned'))
    assert.equal(action.action, 'none')
    assert.equal(action.label, null)
    assert.match(action.hint, /没有时间表/)
  })

  it('随面板分发 → 没有按钮', () => {
    const action = resolveCardAction(makeShelfItem('bundled'))
    assert.equal(action.action, 'none')
    assert.equal(action.label, null)
  })

  it('已装好且不缺授权 → 没有额外按钮（开关在卡片头部）', () => {
    const action = resolveCardAction(makeItem({ state: 'ready', enabled: true }))
    assert.equal(action.action, 'none')
  })

  it('未安装但已有授权 → 导入插件包', () => {
    const action = resolveCardAction(makeShelfItem('obtainable', { message: '' }))
    assert.equal(action.action, 'import')
    assert.equal(action.label, '导入插件包')
  })
})

describe('分区与筛选', () => {
  const items = [
    makeItem({ id: 'installed-one', name: '已装的' }),
    makeShelfItem('obtainable', { id: 'shelf-one', name: '可获取的' }),
    makeShelfItem('planned', { id: 'planned-one', name: '没开发的' }),
  ]

  it('分成已安装 / 可获取 / 尚未开发三区', () => {
    const groups = groupPluginCards(items)
    assert.deepEqual(groups.map(group => group.key), ['installed', 'obtainable', 'planned'])
    assert.deepEqual(groups[0]!.items.map(item => item.id), ['installed-one'])
    assert.deepEqual(groups[1]!.items.map(item => item.id), ['shelf-one'])
    assert.deepEqual(groups[2]!.items.map(item => item.id), ['planned-one'])
  })

  it('空关键词不过滤，返回一份新数组', () => {
    const result = filterPluginCards(items, '   ')
    assert.equal(result.length, 3)
    assert.notEqual(result, items)
  })

  it('按名称、标识与发布方都能搜到', () => {
    assert.equal(filterPluginCards(items, '没开发').length, 1)
    assert.equal(filterPluginCards(items, 'shelf-one').length, 1)
    assert.equal(filterPluginCards(items, 'gsh-official').length, 3)
    assert.equal(filterPluginCards(items, '不存在的词').length, 0)
  })

  it('概览只统计已安装的那部分', () => {
    const summary = summarizePlugins([
      makeItem({ enabled: true, state: 'ready', runtime: { state: 'running', pid: 1, startedAt: null, restarts: 0, lastError: null } }),
      makeItem({ id: 'two', state: 'missing_license' }),
      makeShelfItem('obtainable', { id: 'three' }),
    ])
    assert.equal(summary.installed, 2)
    assert.equal(summary.running, 1)
    assert.equal(summary.missingLicense, 1)
  })
})

describe('订阅判定', () => {
  it('尚未开发与随面板分发都不算需要订阅', () => {
    assert.equal(needsSubscription(makeShelfItem('planned')), false)
    assert.equal(needsSubscription(makeShelfItem('bundled')), false)
  })

  it('已安装的插件不做订阅判定——它的问题不是「获取」', () => {
    assert.equal(needsSubscription(makeItem({ state: 'missing_license' })), false)
  })
})
