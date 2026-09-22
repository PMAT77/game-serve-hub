import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/**
 * 插件商店页的结构护栏。
 *
 * 这一页有三件事容易在后续改动里被悄悄拆掉，而且都不会让编译失败：
 *   1. 页面挂载（`plugins.vue` 换了组件，菜单点进去就是空白）；
 *   2. 三个 tab 与模板里的 `NTabPane` 对不上（加了 tab 忘了给内容）；
 *   3. 契约里的商店字段被删（后端照旧返回，前端静默少显示一块）。
 * 所以这里用静态断言把结构和契约字段钉住，而不是等界面看起来不对了才发现。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PLUGINS_PAGE_PATH = 'src/views/system/plugins.vue'
const SECTION_PATH = 'src/views/system/PluginsSection.vue'
const CONTRACT_PATH = 'shared/contracts/plugin.ts'

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('插件商店页', () => {
  it('插件页仍然挂载 PluginsSection', () => {
    const source = readRepoFile(PLUGINS_PAGE_PATH)
    assert.ok(
      source.includes('<PluginsSection'),
      '插件页应当挂载 PluginsSection，否则菜单点进去是空白',
    )
  })

  it('三个 tab 都有对应的内容面板', () => {
    const source = readRepoFile(SECTION_PATH)
    for (const name of ['installed', 'obtainable', 'audit']) {
      assert.ok(
        source.includes(`<NTabPane name="${name}"`),
        `插件页缺少 ${name} 这个 tab 的内容面板`,
      )
    }
  })

  it('卡片与两个对话框都在插件模块内', () => {
    for (const relativePath of [
      'src/views/system/components/PluginDetailDialog.vue',
      'src/views/system/components/PluginImportDialog.vue',
      'src/views/system/pluginStorePresentation.ts',
    ]) {
      assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} 应当存在`)
    }
  })

  it('插件页提供导入入口——这是人工交付链路的最后一环', () => {
    const source = readRepoFile(SECTION_PATH)
    assert.ok(source.includes('导入插件包'), '插件页应当有导入插件包的入口')
    assert.ok(source.includes('PluginImportDialog'), '导入对话框应当被挂载')
  })

  it('契约保留商店与导入字段', () => {
    const contract = readRepoFile(CONTRACT_PATH)
    for (const field of [
      'pluginStoreAccessSchema',
      'pluginStoreEntrySchema',
      'pluginPackageAnalysisSchema',
      'pluginImportResultSchema',
      'storeNotice',
      'installed',
      'licenseSatisfied',
    ]) {
      assert.ok(contract.includes(field), `插件契约缺少 ${field}`)
    }
  })

  it('面板不是收银台：不出现自助下单与支付的按钮', () => {
    const source = readRepoFile(SECTION_PATH)
    /**
     * 「下单」「支付」这两个词本身必须允许出现——页面上那句「付款与合同在面板之外完成，
     * 面板不提供下单与支付」正是在用它们把边界说清楚。所以这里不查词，
     * 而是查它们有没有变成按钮：文字被包在 NButton 里才是入口。
     */
    for (const label of ['立即购买', '点击升级', '去支付', '立即订阅', '结算']) {
      assert.ok(
        !source.includes(label),
        `插件页不应当出现「${label}」这类促销或收银措辞`,
      )
    }
    const buttonLabels = [...source.matchAll(/<NButton[^>]*>\s*([^<]+?)\s*<\/NButton>/g)]
      .map(match => match[1] ?? '')
    for (const label of buttonLabels) {
      assert.ok(
        !/(支付|购买|付款|下单|结算)/.test(label),
        `按钮「${label}」看起来是收银入口；面板只提供订阅咨询，付款在面板之外`,
      )
    }
  })

  /**
   * 菜单隐藏链路的两端。
   *
   * 这一条是被真实缺陷逼出来的：后端 `menuRouteList` 里给插件模块加了 `menu: false`、
   * 渲染层也如实检查 `meta.menu !== false`，但前端 `convertRouteToMenu` 在构造主导航项时
   * 只复制了 title / icon / auth，把标记丢了——**菜单照旧显示**，而 `vue-tsc`、`oxlint`
   * 与全部单测都不报错。原因是框架类型把主导航 meta 限制为 `Pick<..., 'auth'|'title'|'icon'>`，
   * `menu` 在那个层级无法用类型表达（见 `packages/types/types.ts` 的 `MenuRecordMainRaw`）。
   *
   * 所以这里同时钉住两端：后端确实声明了隐藏，前端确实会过滤掉它。
   * 只钉一端的话，另一端被改成"顺手优化"时没人拦得住。
   */
  it('暂时隐藏的模块确实被前端菜单转换层过滤（菜单消失的那一半在这里）', () => {
    const menuStore = readRepoFile('src/store/modules/app/menu.ts')
    assert.ok(
      /menu === false/.test(menuStore),
      'convertRouteToMenu 必须过滤掉 meta.menu === false 的模块，否则隐藏声明不会生效',
    )

    const menuRoutes = readRepoFile('server/src/shared/menu-routes.ts')
    const pluginsModule = menuRoutes.slice(menuRoutes.indexOf("title: '插件'"))
    assert.ok(
      pluginsModule.slice(0, 600).includes('menu: false'),
      '插件模块应当带 menu: false；恢复菜单时删掉它即可',
    )
  })
})
