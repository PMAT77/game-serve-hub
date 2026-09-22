import type { PluginCapability, PluginStoreEntry } from '../../../shared/contracts/plugin'
import { isDangerousPluginCapability } from '../../../shared/contracts/plugin'

/**
 * 官方插件目录（商店货架的静态数据）。
 *
 * 三个设计决定，改动前先读：
 *
 * 1. **为什么需要这份目录**：面板只扫描本机插件目录，空目录时插件页是空的——
 *    用户看不到任何东西，也就无从知道「有什么可装、在哪拿」。而这恰恰是商店页
 *    最该回答的问题。目录补的就是这一层：官方有哪些插件、各自需要什么。
 *
 * 2. **为什么是 TS 常量而不是 JSON**：与 `modules/system/commercial.ts` 同一套理由——
 *    可类型检查、可被测试 import、不依赖打包期的资源相对路径；插件清单那类
 *    「用户放进来的文件」才需要 JSON。
 *
 * 3. **为什么必须带 `access.state`**：`planned` 的条目代表尚未开发的能力。
 *    它出现在货架上是为了如实告知，而不是为了促销——所以它**不能**有订阅入口。
 *    文案纪律（不得暗示 Pro 可用）在 `store-catalog.test.ts` 里有测试钉住，
 *    而 `access.state` 让界面在类型上就无法给 planned 放按钮。
 *
 * ⚠️ `id` 必须与插件清单（`examples/plugins/<目录>/plugin.json`）里的 `id` 完全一致，
 * 不是目录名。已有的三个示例用 `pro-` / `example-` 前缀区分商业与示例，
 * 对不上就会出现「装了却仍显示未获取」的两张卡片（有测试钉住这一点）。
 */
export const PLUGIN_STORE_CATALOG: readonly PluginStoreEntry[] = [
  {
    id: 'pro-remote-backup',
    name: '异地与云备份',
    publisher: 'gsh-official',
    summary: '把存档自动备份到另一台机器、WebDAV 或对象存储。',
    detail:
      '面板自带的是本机备份：机器坏了，备份跟着一起没。这个插件把整份存档定期送到别处——'
      + '另一台机器、WebDAV，或对象存储（用预签名地址直传）。它可以按保留份数清理远端、'
      + '失败时告警，只动远端、不碰本机已有的备份。',
    requiredCapabilities: ['backups:read', 'backups:write', 'backups:delete', 'network:outbound', 'storage:kv'],
    requiredLicense: 'remote-backup',
    access: {
      state: 'obtainable',
      label: '订阅后可获取',
      detail: '获取插件包与授权文件后，在本页导入插件包，把授权文件放进面板数据目录即可启用。',
    },
  },
  {
    id: 'pro-audit-log',
    name: '操作审计日志',
    publisher: 'gsh-official',
    summary: '把「谁在什么时候改了什么」按天归档成可交付的文件。',
    detail:
      '面板已经记下每一次写操作（含被拒的），但那是给排查用的流水。这个插件解决的是**留存与交付**：'
      + '按天归档成文件、可以交给接手的人、可选推送到与存档不同的一块盘、对敏感操作告警。',
    requiredCapabilities: ['operations:read', 'network:outbound', 'storage:kv'],
    requiredLicense: 'audit-log',
    access: {
      state: 'obtainable',
      label: '订阅后可获取',
      detail: '获取插件包与授权文件后，在本页导入插件包，把授权文件放进面板数据目录即可启用。',
    },
  },
  {
    id: 'example-audit-reporter',
    name: '示例：调用记录播报',
    publisher: 'gsh-official',
    summary: '演示插件如何调用面板能力，用来对照写自己的插件。',
    detail:
      '读取实例列表、读取自己的调用记录，把结果写到插件目录。它不提供运维价值，'
      + '存在的意义是给要自己写插件的人一份能跑通的对照代码，包括清单字段、环境变量约定、'
      + '退出语义与日志去向。无需任何授权。',
    requiredCapabilities: ['instances:read'],
    requiredLicense: null,
    access: {
      state: 'bundled',
      label: '随面板分发',
      detail: '随面板一同提供，放进插件目录即可识别；本机检测不到时说明面板安装不完整。',
    },
  },
  {
    id: 'pro-multi-node',
    name: '多节点统一管理',
    publisher: 'gsh-official',
    summary: '一个面板管多台服务器的实例、日志与批量操作。',
    detail:
      '当前面板是单节点架构：一台机器上的一份数据目录、一套实例。多节点方案需要在每台被管机器上'
      + '装一个轻量代理（心跳、实例生命周期、日志转发），由一台中心面板统一查看与批量操作。'
      + '**尚未开发，也没有获取方式**；这里列出来是为了如实说明规划边界，不是促销，也不代表现在能买到。',
    requiredCapabilities: ['instances:read', 'metrics:read', 'console:read'],
    requiredLicense: 'multi-node',
    access: {
      state: 'planned',
      label: '尚未开发',
      detail: '仍在规划中，没有时间表，也没有任何获取方式。',
    },
  },
  {
    id: 'pro-advanced-rbac',
    name: '高级权限与角色',
    publisher: 'gsh-official',
    summary: '按角色分配权限点、按实例归属隔离，供小团队协作。',
    detail:
      '面板后端已有账号与权限点，但只有一套固定角色，成员管理界面也尚未提供。'
      + '这个插件面向需要「谁能碰哪个实例」的多用户场景。**尚未开发，也没有获取方式**；'
      + '需要多用户权限隔离的现在请先看同类面板。',
    requiredCapabilities: ['instances:read', 'operations:read'],
    requiredLicense: 'advanced-rbac',
    access: {
      state: 'planned',
      label: '尚未开发',
      detail: '仍在规划中，没有时间表，也没有任何获取方式。',
    },
  },
]

/**
 * 货架区的口径说明，由服务端统一给出。
 *
 * 为什么不让前端各写一句：这句话同时约束了三件事——只列官方插件、付款在面板之外、
 * 以及本页不是收银台。分散到多个组件里，迟早会出现自相矛盾的说法
 * （仓库历史上就出现过「没有付费项」与「规划中的 Pro 插件」并存的矛盾）。
 */
export const PLUGIN_STORE_NOTICE
  = '这里只列官方插件；面板不提供下单与支付，付款与合同都在面板之外完成，本页只负责说明来源、授权要求与导入方式。'

/** 按插件 id 取目录条目；找不到（用户自装的第三方插件）返回 undefined */
export function findStoreEntry(pluginId: string): PluginStoreEntry | undefined {
  return PLUGIN_STORE_CATALOG.find(entry => entry.id === pluginId)
}

/** 商业插件：需要商业授权，或必须以带签名的包交付 */
export function isCommercialStoreEntry(entry: PluginStoreEntry): boolean {
  return entry.requiredLicense !== null || entry.access.state === 'obtainable'
}

/**
 * 目录条目声明的能力里是否有危险能力。
 *
 * 危险能力的判定**复用** `shared/contracts/plugin.ts` 的 `isDangerousPluginCapability`，
 * 不在这里手写一份：卡片在「未安装」时给出的风险提示，必须与装好后启用时的确认弹窗
 * 用同一把尺子。手写的那一份一旦漏掉某个能力（例如 `backups:delete`），
 * 就会出现「卡片说没事、启用时却弹确认」的错位。
 */
export function storeEntryDangerousCapabilities(entry: PluginStoreEntry): PluginCapability[] {
  return entry.requiredCapabilities.filter(isDangerousPluginCapability)
}
