import type { PluginListItem, PluginListResult, PluginStoreEntry } from '../../../shared/contracts/plugin'
import { isDangerousPluginCapability } from '../../../shared/contracts/plugin'
import { hasLicenseCapability } from '../shared/license'
import { isCommercialStoreEntry, PLUGIN_STORE_CATALOG, PLUGIN_STORE_NOTICE } from './store-catalog'

/**
 * 把「本机扫描结果」与「官方插件目录」合并成一份商店列表。
 *
 * 合并规则只有一条主线：**一个插件 id 只出一张卡片**。
 * 已装的以本机为准（它才有版本、进程状态和签名结论），目录只补它的产品文案；
 * 没装的才用目录生成占位卡片。这条规则不能松：一旦同一个 id 出两张卡，
 * 用户会看到「已安装」和「未获取」同时存在，那是比空页面更难解释的状态。
 *
 * 第二个决定：**已安装插件的产品文案以目录为准**，而不是用清单里的 `description`。
 * 清单是插件自己写的、不受我们控制；目录里那几句话是对客户的交付承诺，
 * 两者冲突时以发布方给的为准。目录里没有的第三方插件才回落到清单描述。
 *
 * 本函数是纯函数（不读文件、不读环境变量）：扫描与授权判定都留在 `scanPlugins()` 里，
 * 授权结论由 `hasLicense` 注入，因此测试不必构造许可文件也能覆盖两种结论。
 */
export function mergePluginStore(
  scanResult: PluginListResult,
  catalog: readonly PluginStoreEntry[] = PLUGIN_STORE_CATALOG,
  hasLicense: (capability: string) => boolean = hasLicenseCapability,
): PluginListResult {
  const installedIds = new Set(scanResult.items.map(item => item.id))

  const installed = scanResult.items.map(item => applyCatalogCopy(item, catalog))

  const placeholders = catalog
    .filter(entry => !installedIds.has(entry.id))
    .map(entry => catalogPlaceholder(entry, hasLicense))

  return {
    ...scanResult,
    // 已装的排在前面：管理员多数时候是来看状态的，货架是次要动作
    items: [...installed, ...placeholders],
    storeNotice: PLUGIN_STORE_NOTICE,
  }
}

/** 给已安装插件补上目录里的产品文案（目录没有则保持 null） */
function applyCatalogCopy(item: PluginListItem, catalog: readonly PluginStoreEntry[]): PluginListItem {
  const entry = catalog.find(candidate => candidate.id === item.id)
  if (!entry) {
    return { ...item, installed: true, store: null }
  }
  return {
    ...item,
    installed: true,
    store: {
      summary: entry.summary,
      detail: entry.detail,
      access: entry.access,
      requiredLicense: entry.requiredLicense,
      // 已安装的条目不在这里判断授权：它的结论已经在 `state` 上（缺授权时是 missing_license），
      // 再给一个平行的布尔值，界面就要在两处之间做选择，迟早会出现两处不一致
    },
  }
}

/**
 * 目录条目 → 未安装的占位卡片。
 *
 * 三个字段刻意给「空」而不是伪造值，界面与调用方都据此判断它不是一个真实插件：
 * - `directory`：空串。这里**不能**填目录名猜一个路径——管理员照着它去翻文件会落空；
 * - `version`：`-`，与 `scanPlugins()` 里装载失败的分支保持一致；
 * - `runtime`：全部为 stopped 的零值，表示「没有任何进程」而不是「进程没起来」。
 */
function catalogPlaceholder(entry: PluginStoreEntry, hasLicense: (capability: string) => boolean): PluginListItem {
  return {
    id: entry.id,
    name: entry.name,
    version: '-',
    apiVersion: 0,
    kind: isCommercialStoreEntry(entry) ? 'commercial' : 'community',
    state: 'disabled',
    enabled: false,
    message: '',
    capabilities: [...entry.requiredCapabilities],
    hasDangerousCapabilities: entry.requiredCapabilities.some(capability => isDangerousPluginCapability(capability)),
    signed: false,
    publisher: entry.publisher,
    description: null,
    author: null,
    directory: '',
    runtime: {
      state: 'stopped',
      pid: null,
      startedAt: null,
      restarts: 0,
      lastError: null,
    },
    installed: false,
    store: {
      summary: entry.summary,
      detail: entry.detail,
      access: entry.access,
      requiredLicense: entry.requiredLicense,
      /**
       * 「已经买过、只是还没导入插件包」这个中间态全靠这里。
       * 判断交给调用方注入（`hasLicenseCapability`），本文件保持纯函数——
       * 于是测试不必去构造许可文件，也能覆盖两种结论。
       */
      licenseSatisfied: entry.requiredLicense === null || hasLicense(entry.requiredLicense),
    },
  }
}
