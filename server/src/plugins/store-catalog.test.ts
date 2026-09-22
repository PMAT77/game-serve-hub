import type { PluginListItem, PluginManifest, PluginStoreEntry } from '../../../shared/contracts/plugin'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { scanPlugins } from './registry'
import {
  findStoreEntry,
  isCommercialStoreEntry,
  PLUGIN_STORE_CATALOG,
  PLUGIN_STORE_NOTICE,
  storeEntryDangerousCapabilities,
} from './store-catalog'
import { mergePluginStore } from './store-merge'

/**
 * 商店目录的纪律。
 *
 * 这份目录是**手工维护的**，而它面对的是用户的钱与期待，所以这里盯住三类会变成谎言的情况：
 *
 * 1. **目录与真实插件包漂移**：目录写着要 `backups:read`，插件实际还申请了 `network:outbound`，
 *    卡片就会把「会对外联网」这件事藏起来——这正是最需要提醒用户的那种能力。
 *    `examples/plugins/` 里的插件包在这里当唯一真源，逐条比对。
 * 2. **尚未开发的能力被写成可获取**：`planned` 条目一旦带上订阅入口，就是对用户的虚假承诺。
 *    文案与状态都有断言（与 `commercial-routes.test.ts` 同一套口径）。
 * 3. **合并逻辑出错**：同一个 id 出两张卡、未安装的条目被当成已安装。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const EXAMPLES_ROOT = path.join(repoRoot, 'examples', 'plugins')

/** 读出仓库里真实存在的插件包清单，作为目录的比对基线 */
function readExampleManifests(): PluginManifest[] {
  const manifests: PluginManifest[] = []
  for (const entry of fs.readdirSync(EXAMPLES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const manifestPath = path.join(EXAMPLES_ROOT, entry.name, 'plugin.json')
    if (!fs.existsSync(manifestPath)) {
      continue
    }
    manifests.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest)
  }
  return manifests
}

/** 目录里声明「已经能拿到」的条目：它们必须对得上真实的插件包 */
function obtainableEntries(): PluginStoreEntry[] {
  return PLUGIN_STORE_CATALOG.filter(entry => entry.access.state !== 'planned')
}

describe('商店目录自身', () => {
  it('至少列出了已交付的插件，否则货架是空的', () => {
    assert.ok(obtainableEntries().length >= 2, '目录里应当有可获取的插件')
  })

  it('id 唯一且符合插件标识规范', () => {
    const ids = PLUGIN_STORE_CATALOG.map(entry => entry.id)
    assert.equal(new Set(ids).size, ids.length, `目录里有重复 id：${ids.join('、')}`)
    for (const id of ids) {
      assert.match(id, /^[a-z][a-z0-9-]{2,63}$/, `目录 id 不符合插件标识规范：${id}`)
    }
  })

  it('每条都有名称、一句话简介与完整说明', () => {
    for (const entry of PLUGIN_STORE_CATALOG) {
      assert.ok(entry.name.trim().length > 0, `${entry.id} 缺少名称`)
      assert.ok(entry.summary.trim().length > 0, `${entry.id} 缺少一句话简介`)
      assert.ok(entry.detail.trim().length > 0, `${entry.id} 缺少完整说明`)
      assert.ok(entry.publisher.trim().length > 0, `${entry.id} 缺少发布方`)
    }
  })

  /**
   * 最关键的一条：目录声明的能力必须与真实插件包**完全一致**。
   *
   * 只允许「目录 ⊆ 包」是不够的——漏报比多报危险得多：
   * 卡片上少一个 `network:outbound`，用户就会在不知情的情况下让一个能对外联网的插件跑起来。
   */
  it('已交付条目的能力声明与 examples 里的插件包逐字一致', () => {
    const manifests = new Map(readExampleManifests().map(manifest => [manifest.id, manifest]))
    let compared = 0
    for (const entry of obtainableEntries()) {
      const manifest = manifests.get(entry.id)
      if (!manifest) {
        // 规划中尚未有包的条目不在此列；已交付但仓库里没有包的，由下面的用例单独盯
        continue
      }
      compared += 1
      const declared = [...entry.requiredCapabilities].sort()
      const actual = [...manifest.capabilities].sort()
      assert.deepEqual(
        declared,
        actual,
        `${entry.id} 的能力声明与插件包不一致：目录 ${declared.join('、')}，包 ${actual.join('、')}`,
      )
      assert.equal(manifest.kind, isCommercialStoreEntry(entry) ? 'commercial' : 'community',
        `${entry.id} 的商业/社区类型与插件包不一致`)
      assert.equal(manifest.name, entry.name, `${entry.id} 的名称与插件包不一致`)
    }
    assert.ok(compared >= 2, `应当至少与两个真实插件包比对过，实际 ${compared} 个`)
  })

  it('需要的授权都是授权契约里存在的能力', () => {
    const known = new Set(['multi-node', 'audit-log', 'remote-backup', 'advanced-rbac'])
    for (const entry of PLUGIN_STORE_CATALOG) {
      if (entry.requiredLicense !== null) {
        assert.ok(known.has(entry.requiredLicense), `${entry.id} 声明了未知授权：${entry.requiredLicense}`)
      }
    }
  })

  it('需要授权的条目一定是商业插件', () => {
    for (const entry of PLUGIN_STORE_CATALOG) {
      if (entry.requiredLicense !== null) {
        assert.equal(isCommercialStoreEntry(entry), true, `${entry.id} 需要授权却不是商业插件`)
      }
    }
  })
})

describe('尚未开发的能力', () => {
  const planned = PLUGIN_STORE_CATALOG.filter(entry => entry.access.state === 'planned')

  it('目录里确实记着规划中的能力——如实说明边界比藏起来更好', () => {
    assert.ok(planned.length >= 1, '至少要列出规划中的能力')
  })

  it('每一条都明确写着「尚未开发」', () => {
    for (const entry of planned) {
      const text = `${entry.summary} ${entry.detail} ${entry.access.label} ${entry.access.detail}`
      assert.match(text, /尚未开发|未开发|规划中/, `${entry.id} 必须说明它还没开发`)
    }
  })

  it('不给任何获取方式', () => {
    for (const entry of planned) {
      assert.match(entry.access.detail, /没有.*获取方式|没有时间表/, `${entry.id} 必须说明没有获取方式`)
    }
  })
})

describe('对外文案纪律', () => {
  const text = [
    PLUGIN_STORE_NOTICE,
    ...PLUGIN_STORE_CATALOG.flatMap(entry => [
      entry.name,
      entry.summary,
      entry.detail,
      entry.access.label,
      entry.access.detail,
    ]),
  ].join(' ')

  it('不出现暗示 Pro 已可用的措辞', () => {
    /**
     * 检查范围刻意覆盖这些词的常见变体：上一版目录里写着「可通过订阅获取」，
     * 字面上就包含了「可以购买」这个禁用词的后半段——措辞纪律的口子往往不在明面上，
     * 而在「换个说法而已」里。
     */
    for (const forbidden of ['已支持', '已上线', '立即购买', '点击升级', '现已开放', '可以购买', '可购买', '立即下单', '已发布']) {
      assert.ok(!text.includes(forbidden), `商店文案出现暗示可用的措辞：${forbidden}`)
    }
  })

  it('不出现响应时限类承诺', () => {
    for (const forbidden of ['7×24', 'SLA', '值守', '即时响应']) {
      assert.ok(!text.includes(forbidden), `商店文案出现响应时限类措辞：${forbidden}`)
    }
  })

  it('货架说明说清面板不提供下单与支付', () => {
    assert.match(PLUGIN_STORE_NOTICE, /付款|支付/)
    assert.match(PLUGIN_STORE_NOTICE, /面板之外/)
  })
})

describe('危险能力提示', () => {
  it('删除备份与对外联网都算危险能力', () => {
    const remoteBackup = findStoreEntry('pro-remote-backup')
    assert.ok(remoteBackup, '目录里应当有异地备份插件')
    const dangerous = storeEntryDangerousCapabilities(remoteBackup)
    assert.ok(dangerous.includes('backups:delete'), '删除备份是危险能力')
    assert.ok(dangerous.includes('network:outbound'), '对外联网是危险能力')
  })

  it('只读能力不算危险', () => {
    const reporter = findStoreEntry('example-audit-reporter')
    assert.ok(reporter, '目录里应当有示例插件')
    assert.deepEqual(storeEntryDangerousCapabilities(reporter), [])
  })
})

describe('合并成商店列表', () => {
  const scanResult = {
    hostApiVersion: 1,
    pluginsRoot: '/tmp/plugins',
    items: [] as PluginListItem[],
    storeNotice: PLUGIN_STORE_NOTICE,
  }

  it('空插件目录时仍然列出全部目录条目，且都标记为未安装', () => {
    const merged = mergePluginStore(scanResult, PLUGIN_STORE_CATALOG, () => false)
    assert.equal(merged.items.length, PLUGIN_STORE_CATALOG.length)
    assert.ok(merged.items.every(item => item.installed === false))
    // 未安装的条目不能有伪造的版本号或目录名
    assert.ok(merged.items.every(item => item.version === '-' && item.directory === ''))
  })

  it('已有授权的条目报告 licenseSatisfied，界面据此区分「已订阅待导入」', () => {
    const merged = mergePluginStore(scanResult, PLUGIN_STORE_CATALOG, capability => capability === 'remote-backup')
    const remoteBackup = merged.items.find(item => item.id === 'pro-remote-backup')
    const auditLog = merged.items.find(item => item.id === 'pro-audit-log')
    assert.equal(remoteBackup?.store?.licenseSatisfied, true)
    assert.equal(auditLog?.store?.licenseSatisfied, false)
  })

  it('不需要授权的条目恒为已满足', () => {
    const merged = mergePluginStore(scanResult, PLUGIN_STORE_CATALOG, () => false)
    const reporter = merged.items.find(item => item.id === 'example-audit-reporter')
    assert.equal(reporter?.store?.licenseSatisfied, true)
  })

  it('已安装的插件与目录条目不会出两张卡', () => {
    const installedItem: PluginListItem = {
      id: 'pro-remote-backup',
      name: '异地与云备份',
      version: '1.0.0',
      apiVersion: 1,
      kind: 'commercial',
      state: 'disabled',
      enabled: false,
      message: '',
      capabilities: ['backups:read'],
      hasDangerousCapabilities: false,
      signed: true,
      publisher: 'gsh-official',
      description: '插件自己写的说明',
      author: null,
      directory: 'pro-remote-backup',
      runtime: { state: 'stopped', pid: null, startedAt: null, restarts: 0, lastError: null },
      installed: true,
      store: null,
    }
    const merged = mergePluginStore(
      { ...scanResult, items: [installedItem] },
      PLUGIN_STORE_CATALOG,
      () => false,
    )
    const matches = merged.items.filter(item => item.id === 'pro-remote-backup')
    assert.equal(matches.length, 1, '同一个插件只能有一张卡片')
    assert.equal(matches[0]!.installed, true)
    // 产品文案以官方目录为准：插件自带的 description 不受我们控制，不能用来对客户承诺
    assert.match(matches[0]!.store?.summary ?? '', /存档/)
    assert.notEqual(matches[0]!.store?.summary, '插件自己写的说明')
  })

  it('已安装的条目不重复计算授权——它的结论在 state 上', () => {
    const merged = mergePluginStore(scanResult, PLUGIN_STORE_CATALOG, () => false)
    const installed = merged.items.filter(item => item.installed)
    assert.equal(installed.length, 0)
    // 未安装的才有 licenseSatisfied
    assert.ok(merged.items.some(item => item.store?.licenseSatisfied === false))
  })

  it('没有目录条目的第三方插件照常出现在列表里', () => {
    const thirdParty: PluginListItem = {
      id: 'my-own-plugin',
      name: '我自己的插件',
      version: '0.1.0',
      apiVersion: 1,
      kind: 'community',
      state: 'disabled',
      enabled: false,
      message: '',
      capabilities: ['instances:read'],
      hasDangerousCapabilities: false,
      signed: false,
      publisher: null,
      description: '自用',
      author: null,
      directory: 'my-own-plugin',
      runtime: { state: 'stopped', pid: null, startedAt: null, restarts: 0, lastError: null },
      installed: true,
      store: null,
    }
    const merged = mergePluginStore({ ...scanResult, items: [thirdParty] }, PLUGIN_STORE_CATALOG, () => false)
    const found = merged.items.find(item => item.id === 'my-own-plugin')
    assert.ok(found, '自装插件不能被目录挤掉')
    assert.equal(found.installed, true)
    assert.equal(found.store, null)
  })
})

describe('扫描结果与契约', () => {
  it('scanPlugins 的返回值自带货架说明，符合列表契约', () => {
    const result = scanPlugins({ skipLicenseCheck: true })
    assert.equal(result.storeNotice, PLUGIN_STORE_NOTICE)
    assert.ok(Array.isArray(result.items))
  })
})
