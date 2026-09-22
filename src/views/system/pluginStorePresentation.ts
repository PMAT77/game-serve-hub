import type { PluginListItem, PluginState } from '../../../shared/contracts/plugin'
import { DANGEROUS_PLUGIN_CAPABILITIES, isDangerousPluginCapability } from '../../../shared/contracts/plugin'

/**
 * 插件页的呈现层纯函数。
 *
 * 这一层存在的理由是「同一句话只说一遍」：卡片的按钮、状态标签与提示文案
 * 同时受三件事约束——插件在本机的装载状态、当前许可的授权状态、以及目录里声明的获取方式。
 * 把它们散在模板里，迟早会出现「卡片说能装、弹窗说缺授权」这类自相矛盾。
 *
 * 所以这里不碰网络、不碰 DOM、不读环境变量，全部是可以直接断言的输入到输出。
 * 界面只负责把这里给出的结论画出来。
 */

/**
 * 插件能力 → 界面标签。
 *
 * 与 `PluginsSection.vue` 里的旧映射同源，改这里就等于改全站的说法；
 * 未收录的能力原样回落到标识本身（例如 `operations:read`），
 * 而不是显示成空白——管理员至少能照着它去查。
 */
export const PLUGIN_CAPABILITY_LABELS: Record<string, string> = {
  'instances:read': '读取实例',
  'instances:lifecycle': '启停实例',
  'console:read': '读取日志',
  'console:write': '下发命令',
  'metrics:read': '读取指标',
  'backups:read': '读取备份',
  'backups:write': '创建备份',
  'backups:delete': '删除备份',
  'ui:panel': '添加页面',
  'storage:kv': '本地存储',
  'network:outbound': '对外联网',
  'operations:read': '读取操作记录',
}

export function capabilityLabel(capability: string): string {
  return PLUGIN_CAPABILITY_LABELS[capability] ?? capability
}

/**
 * 单个能力是否危险。
 *
 * 判定只有一处真源：`shared/contracts/plugin.ts` 的 `isDangerousPluginCapability`。
 * 卡片标签配色、详情弹窗的风险提示与启用确认弹窗都走这里，三者不会各说各话。
 */
export function isDangerousCapability(capability: string): boolean {
  return isDangerousPluginCapability(capability as never)
}

/** 危险能力的中文清单，用于确认弹窗与卡片提示（顺序固定，便于测试与阅读） */
export function dangerousCapabilityLabels(capabilities: readonly string[]): string[] {
  return DANGEROUS_PLUGIN_CAPABILITIES
    .filter(capability => capabilities.includes(capability))
    .map(capability => capabilityLabel(capability))
}

// ---------------------------------------------------------------------------
// 卡片状态
// ---------------------------------------------------------------------------

/**
 * 卡片的语义状态。**它与插件自己的 `state` 不是一回事**：
 * `state` 只回答「装载与授权怎么了」，而卡片还要表达「没装的那种，下一步能干什么」。
 */
export type PluginCardTone
  = | 'running'
    | 'ready'
    | 'stopped'
    | 'crashed'
    | 'invalid'
    | 'missing-license'
    | 'obtainable'
    | 'licensed-not-installed'
    | 'planned'
    | 'bundled-not-installed'

export interface PluginCardView {
  tone: PluginCardTone
  /** 状态标签文案 */
  label: string
  /** 状态标签配色（naive-ui 的 NTag type） */
  type: 'default' | 'info' | 'warning' | 'error' | 'success'
  /** 本机是否装着它；未安装的卡片在读接口里带 installed: false */
  installed: boolean
  /** 卡片主标题下的说明：优先用官方目录的产品文案 */
  summary: string
  /** 危险能力的提示语；没有则为 null */
  dangerHint: string | null
}

const STATE_META: Record<PluginState, { label: string, type: PluginCardView['type'] }> = {
  ready: { label: '已启用', type: 'success' },
  disabled: { label: '已停用', type: 'default' },
  invalid: { label: '装载失败', type: 'error' },
  // 与「已停用」分开配色：一个是管理员主动关的，一个是买了没装/没授权，两件事
  missing_license: { label: '缺少授权', type: 'warning' },
}

/**
 * 判断本机是否装着这个插件。
 *
 * `installed` 是接口显式给的；缺省（老调用方）按已安装理解——因为引入商店之前，
 * 列表接口返回的每一项都来自本地目录。这条回退规则只写在这里一次。
 */
export function isInstalled(item: PluginListItem): boolean {
  return item.installed !== false
}

/** 把一条列表项翻成卡片视图模型 */
export function buildPluginCard(item: PluginListItem): PluginCardView {
  const installed = isInstalled(item)
  const summary = item.store?.summary ?? item.description ?? ''
  const danger = dangerousCapabilityLabels(item.capabilities)
  const dangerHint = danger.length > 0 ? `会影响实例或对外联网：${danger.join('、')}` : null

  if (installed) {
    return {
      tone: resolveInstalledTone(item),
      label: STATE_META[item.state].label,
      type: STATE_META[item.state].type,
      installed,
      summary,
      dangerHint,
    }
  }

  const access = item.store?.access.state ?? 'obtainable'
  if (access === 'planned') {
    return { tone: 'planned', label: '尚未开发', type: 'default', installed, summary, dangerHint }
  }
  if (access === 'bundled') {
    return { tone: 'bundled-not-installed', label: '本机未检测到', type: 'info', installed, summary, dangerHint }
  }
  /**
   * 未安装但已有授权：这是人工交付链路上最常见的中间态——
   * 许可文件已经放进去了，插件包还没导入。不把它单独说出来，
   * 用户会以为「我买了但面板不认识这笔购买」。
   */
  if (needsSubscription(item)) {
    return { tone: 'obtainable', label: '未获取', type: 'default', installed, summary, dangerHint }
  }
  return { tone: 'licensed-not-installed', label: '已订阅 · 待导入', type: 'success', installed, summary, dangerHint }
}

function resolveInstalledTone(item: PluginListItem): PluginCardTone {
  if (item.state === 'missing_license') {
    return 'missing-license'
  }
  if (item.state === 'invalid') {
    return 'invalid'
  }
  if (!item.enabled) {
    return 'stopped'
  }
  // 「已启用」还不够：进程崩了要看得出来，否则会出现「显示已启用、实际没在跑」
  if (item.runtime.state === 'crashed') {
    return 'crashed'
  }
  return item.runtime.state === 'running' ? 'running' : 'ready'
}

/**
 * 是否还缺授权（即需要走订阅）。
 *
 * 判断依据是服务端给的 `store.licenseSatisfied`，而不是前端自己比对能力清单——
 * 授权判定只有一处真源（服务端的 `readLicenseState` + `resolveLicenseGap`），
 * 前端重算一遍只会得到两种结论。
 *
 * 已安装的插件不在这里判断：它的问题不是「获取」，缺授权时会以 `missing_license`
 * 的状态出现，界面按那个状态处理。
 */
export function needsSubscription(item: PluginListItem): boolean {
  if (isInstalled(item)) {
    return false
  }
  const access = item.store?.access.state ?? 'obtainable'
  if (access !== 'obtainable') {
    // 尚未开发与随面板分发都不涉及订阅，不能给它们按下「订阅」的机会
    return false
  }
  // 缺省（老接口或第三方插件）按「已满足」处理：没有要买的授权，就不该出现订阅入口
  return item.store?.licenseSatisfied === false
}

// ---------------------------------------------------------------------------
// 卡片操作
// ---------------------------------------------------------------------------

export type PluginCardAction = 'none' | 'subscribe' | 'import'

export interface PluginCardActionView {
  action: PluginCardAction
  /** 按钮文案；action 为 none 时为 null（不渲染按钮） */
  label: string | null
  /** 按钮下方的补充说明 */
  hint: string
}

/**
 * 卡片底部的操作。
 *
 * 这里的克制是有意的：`planned` 与 `bundled` 一律不给按钮。
 * 「尚未开发」的能力如果配一个能点的入口，无论按钮叫什么，都是在对用户虚假承诺——
 * 而这条纪律在本仓库是写进测试的（`store-catalog.test.ts` 与 `commercial-routes.test.ts`）。
 *
 * 三种情况会给按钮：
 * - 未安装且未授权 → 订阅（送到面板之外的人工渠道）；
 * - 未安装但已有授权 → 导入插件包（人工交付链路的第二步）；
 * - **已安装却缺授权** → 订阅（这是续期与补买的正经入口；
 *   许可过期时 Pro 操作入口关闭，用户需要一个能问的地方，而不是在两处之间来回找）。
 */
export function resolveCardAction(item: PluginListItem): PluginCardActionView {
  if (isInstalled(item)) {
    if (item.state === 'missing_license') {
      return { action: 'subscribe', label: '订阅授权', hint: '许可文件由面板之外的渠道交付，放进面板数据目录后重新读取即可生效。' }
    }
    return { action: 'none', label: null, hint: '' }
  }
  const access = item.store?.access.state ?? 'obtainable'
  if (access === 'planned') {
    return { action: 'none', label: null, hint: '仍在规划中，没有时间表，也没有获取方式。' }
  }
  if (access === 'bundled') {
    return { action: 'none', label: null, hint: '随面板一同分发，本机检测不到说明面板安装不完整。' }
  }
  if (needsSubscription(item)) {
    return { action: 'subscribe', label: '订阅', hint: '付款与合同在面板之外完成，面板不提供下单与支付。' }
  }
  return { action: 'import', label: '导入插件包', hint: '已经拿到插件包与授权，把包导入并启用即可。' }
}

// ---------------------------------------------------------------------------
// 分区与筛选
// ---------------------------------------------------------------------------

export interface PluginCardGroup {
  key: 'installed' | 'obtainable' | 'planned'
  title: string
  description: string
  items: PluginListItem[]
}

/**
 * 把列表分成「已安装 / 可获取 / 尚未开发」三区。
 *
 * 「尚未开发」单独成区而不是混在货架里：混在一起会让人以为它们也能装，
 * 而分成一区并写明原因，才符合「如实说明规划边界」的口径。
 */
export function groupPluginCards(items: readonly PluginListItem[]): PluginCardGroup[] {
  const installed: PluginListItem[] = []
  const obtainable: PluginListItem[] = []
  const planned: PluginListItem[] = []
  for (const item of items) {
    if (isInstalled(item)) {
      installed.push(item)
      continue
    }
    if ((item.store?.access.state ?? 'obtainable') === 'planned') {
      planned.push(item)
      continue
    }
    obtainable.push(item)
  }
  return [
    {
      key: 'installed',
      title: '已安装',
      description: '插件以独立进程运行，崩溃或停用都不影响面板与正在运行的游戏实例。',
      items: installed,
    },
    {
      key: 'obtainable',
      title: '可获取',
      description: '官方插件。拿到插件包后在本页导入，授权文件另放进面板数据目录。',
      items: obtainable,
    },
    {
      key: 'planned',
      title: '尚未开发',
      description: '以下能力仍在规划中，没有时间表，也没有获取方式；列在这里只为如实说明边界。',
      items: planned,
    },
  ]
}

/** 关键词筛选：名称、标识、简介与发布方都算命中，空关键词不过滤 */
export function filterPluginCards(items: readonly PluginListItem[], keyword: string): PluginListItem[] {
  const trimmed = keyword.trim().toLowerCase()
  if (!trimmed) {
    return [...items]
  }
  return items.filter((item) => {
    const haystack = [
      item.name,
      item.id,
      item.publisher ?? '',
      item.store?.summary ?? '',
      item.description ?? '',
    ].join(' ').toLowerCase()
    return haystack.includes(trimmed)
  })
}

/** 概览：三个数字足以说明这页的状态，不需要更多指标 */
export interface PluginStoreSummary {
  installed: number
  running: number
  missingLicense: number
}

export function summarizePlugins(items: readonly PluginListItem[]): PluginStoreSummary {
  const installed = items.filter(isInstalled)
  return {
    installed: installed.length,
    running: installed.filter(item => item.runtime.state === 'running').length,
    missingLicense: installed.filter(item => item.state === 'missing_license').length,
  }
}
