import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MenuRecordRaw } from '@fantastic-admin/types'
import { FRONTEND_ROUTE_PATHS } from '../../../../shared/constants/frontend-routes.ts'
import { menuRouteList } from '../../../../server/src/shared/menu-routes.ts'
import type { MenuRouteItem } from '../../../../server/src/shared/menu-routes.ts'
import { flattenModuleChildrenForSingleMode } from './menu-flatten.ts'

/**
 * 单栏（`single`）菜单模式下模块入口的可达性。
 *
 * 背景：`src/settings.ts` 把菜单布局设为 `single`，这种布局**不渲染图标栏**
 * （`src/layouts/index.vue` 的 `isMainSidebarEnable` 只在 `side` 模式为真），左侧只有
 * 二级导航，画的是 `allMenus[actived].children`。而单页模块（当前只有「系统设置」）
 * 的页面按约定是 `menu: false`——它的入口本来是图标栏那一项，在 `single` 下没有图标栏，
 * 页面又被 `Menu/index.vue` 的 `menu === false` 过滤掉，于是**左侧菜单里「系统设置」整个消失**。
 *
 * `flattenModuleChildrenForSingleMode` 负责把这种模块的子项平铺成可见项。
 * 这里用**真实菜单数据**（不是夹具）钉住四件事：
 *   1. 单页模块在 `single` 下作为可见项出现，标题是模块名，权限点原样保留；
 *   2. 其它模块（多页、暂时隐藏的「插件」）逐字不变；
 *   3. side / head 模式的输出与改造前一致，单页模块的页面必须继续 `menu: false`
 *      （否则图标栏与二级导航会各画一个同名「系统设置」，那是已修过的回归）；
 *   4. 平铺不就地改写菜单数据（`menuRouteList` 是前后端共享的单例）。
 */

/** 模拟 `convertRouteToMenu` 的模块级过滤：模块自己 `menu: false` 时整个模块从菜单里消失 */
function filterHiddenModules(routes: MenuRouteItem[]): MenuRouteItem[] {
  return routes.filter(item => item.meta.menu !== false)
}

/** 模拟 `convertRouteToMenu` 在 `single` 模式下的平铺结果（单组、children 即全部入口） */
function flattenForSingleMode(): MenuRecordRaw[] {
  const menus: MenuRecordRaw[] = []
  for (const module of filterHiddenModules(menuRouteList)) {
    menus.push(...flattenModuleChildrenForSingleMode(
      module.children ?? [],
      module.path ?? '',
      'single',
      module.meta.title,
    ))
  }
  return menus
}

function visibleTitles(menus: MenuRecordRaw[]): string[] {
  return menus.filter(menu => menu.meta?.menu !== false).map(menu => String(menu.meta?.title))
}

describe('单栏菜单模式下的模块入口', () => {
  it('单页模块（系统设置）在 single 模式下是可见入口，且指向设置页', () => {
    const settings = flattenForSingleMode()
      .find(menu => menu.path === FRONTEND_ROUTE_PATHS.systemSettings)

    assert.ok(settings, 'single 模式下左侧菜单里应当有「系统设置」这一项')
    assert.equal(settings.meta?.title, '系统设置', '入口文字应当取模块名，页面改名不该让它漂移')
    assert.notEqual(settings.meta?.menu, false, '入口必须是可见项，否则渲染层会直接跳过它')
  })

  it('单页模块的权限点原样保留：只读账号不会多出一个点进去吃 403 的入口', () => {
    const settingsPage = menuRouteList
      .find(module => module.meta.title === '系统设置')
      ?.children?.[0]

    const settings = flattenForSingleMode()
      .find(menu => menu.path === FRONTEND_ROUTE_PATHS.systemSettings)

    assert.ok(settingsPage, '菜单数据里应当有系统设置页')
    assert.equal(
      settings?.meta?.auth,
      settingsPage.meta.auth,
      '平铺只负责可见性，权限过滤仍由 filterAsyncMenus 按 auth 判断',
    )
  })

  it('其它模块逐项不变，暂时隐藏的「插件」模块仍然不出现在菜单里', () => {
    const menus = flattenForSingleMode()
    const visible = visibleTitles(menus)

    // 多页模块的每个页面都照旧可见——改造只碰「全部子项都隐藏」的模块
    for (const module of filterHiddenModules(menuRouteList)) {
      const pages = (module.children ?? []).filter(page => page.meta.menu !== false)
      for (const page of pages) {
        assert.ok(
          visible.includes(String(page.meta.title)),
          `「${module.meta.title}」下的「${page.meta.title}」在 single 模式下不该消失`,
        )
      }
    }

    assert.equal(
      menus.some(menu => menu.path === FRONTEND_ROUTE_PATHS.plugins),
      false,
      '「插件」是模块级 menu: false 的暂时隐藏项，不该被平铺逻辑重新放出来',
    )
  })

  it('side / head 模式输出与改造前一致：单页模块的页面继续隐藏', () => {
    const systemModule = menuRouteList.find(module => module.meta.title === '系统设置')
    assert.ok(systemModule, '菜单数据里应当有系统设置模块')

    for (const mode of ['side', 'head'] as const) {
      const menus = flattenModuleChildrenForSingleMode(
        systemModule.children ?? [],
        systemModule.path ?? '',
        mode,
        systemModule.meta.title,
      )

      assert.equal(menus.length, 1, `${mode} 模式下系统设置模块仍应只有一个页面项`)
      assert.equal(
        menus[0]!.meta?.menu,
        false,
        `${mode} 模式靠图标栏那一项进入单页模块，页面必须保持隐藏，否则会画出两个同名入口`,
      )
      assert.equal(menus[0]!.meta?.title, '系统设置', `${mode} 模式下页面标题不应被改写`)
    }
  })

  it('平铺不就地改写菜单数据（menuRouteList 是前后端共享的单例）', () => {
    const before = JSON.stringify(menuRouteList)
    flattenForSingleMode()
    assert.equal(JSON.stringify(menuRouteList), before, '菜单转换不得修改共享的菜单定义')
  })
})
