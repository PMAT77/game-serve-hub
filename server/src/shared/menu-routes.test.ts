import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { FRONTEND_ROUTE_PATHS } from '../../../shared/constants/frontend-routes'
import {
  menuRouteList,
  SYSTEM_MANAGE_PERMISSION,
  SYSTEM_READ_PERMISSION,
} from './menu-routes'
import type { MenuRouteItem } from './menu-routes'

/**
 * 菜单与路由的一致性检查。
 *
 * 菜单是后端驱动的：`component` 是 `src/views/` 下的相对路径，写错不会在编译期报错，
 * 只会在用户点进去时白屏——而这类错误恰恰最容易在"把某个卡片抽成独立页面"时发生。
 *
 * 这里钉住四件事：
 * 1. 每个 `component` 指向的文件真实存在；
 * 2. 页面路径（含 FRONTEND_ROUTE_PATHS 常量）与前端 activeMenu 对得上；
 * 3. 同级菜单项标题不重复（历史上出现过"控制台 > 控制台"式嵌套），
 *    且单页模块不再套同名容器（否则图标栏与二级导航各画一个「系统设置」）；
 * 4. 每个主导航模块都有可点入口：多页模块靠可见页面，单页模块（系统设置）靠页面本身，
 *    防止页面重新变成"路由可达但无处可点"。
 */

/**
 * 暂时从侧边栏隐藏的模块。
 *
 * 隐藏不是「删掉」：这些模块的路由、接口与页面组件都还在，只是入口收起来了，
 * 所以「主导航都有可点入口」那条检查对它们不适用——但必须**显式**列在这里，
 * 而不是靠测试漏过去。将来恢复时删掉名单里的一项，对应用例会立刻要求它重新可点。
 */
const TEMPORARILY_HIDDEN_MODULES = new Set(['插件'])

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** 递归收集所有菜单项 */
function flatten(items: MenuRouteItem[], acc: MenuRouteItem[] = []): MenuRouteItem[] {
  for (const item of items) {
    acc.push(item)
    if (item.children) {
      flatten(item.children, acc)
    }
  }
  return acc
}

/** 收集所有需要落地的页面组件（Layout 是框架内置容器，不是 views 下的文件） */
function collectViewComponents(items: MenuRouteItem[]): Array<{ component: string, title: string }> {
  return flatten(items)
    .filter(item => typeof item.component === 'string' && item.component !== 'Layout')
    .map(item => ({ component: item.component as string, title: item.meta.title }))
}

/** 收集所有真实落地的页面（不含 Layout 容器） */
function collectPages(): MenuRouteItem[] {
  return flatten(menuRouteList).filter(item => item.component && item.component !== 'Layout')
}

describe('菜单与路由一致性', () => {
  it('每个菜单页面组件都真实存在', () => {
    const missing: string[] = []
    for (const { component, title } of collectViewComponents(menuRouteList)) {
      const filePath = path.join(repoRoot, 'src', 'views', component)
      if (!fs.existsSync(filePath)) {
        missing.push(`${title} → src/views/${component}`)
      }
    }
    assert.deepEqual(missing, [], `菜单指向了不存在的页面：\n${missing.join('\n')}`)
  })

  it('activeMenu 使用的路径都在前端路由常量里，且与页面路径能对上', () => {
    const knownPaths = new Set<string>(Object.values(FRONTEND_ROUTE_PATHS))
    // 容器自身的路径（如 /system、/console）不需要出现在常量表里，它们只用于分组
    const containerPaths = new Set(
      flatten(menuRouteList)
        .filter(item => item.component === 'Layout')
        .map(item => item.path)
        .filter((value): value is string => typeof value === 'string'),
    )

    const unknown: string[] = []
    for (const item of flatten(menuRouteList)) {
      const activeMenu = item.meta.activeMenu
      if (typeof activeMenu !== 'string') {
        continue
      }
      if (!knownPaths.has(activeMenu) && !containerPaths.has(activeMenu)) {
        unknown.push(`${item.meta.title} 的 activeMenu=${activeMenu}`)
      }
    }
    assert.deepEqual(unknown, [], `activeMenu 指向了未知路径：\n${unknown.join('\n')}`)
  })

  it('同级菜单标题不重复（避免「设置 > 设置」式嵌套）', () => {
    const duplicates: string[] = []
    const walk = (items: MenuRouteItem[], parent: string) => {
      const seen = new Set<string>()
      for (const item of items) {
        if (seen.has(item.meta.title)) {
          duplicates.push(`${parent || '根'} 下重复出现「${item.meta.title}」`)
        }
        seen.add(item.meta.title)
        if (item.children) {
          walk(item.children, item.meta.title)
        }
      }
    }
    walk(menuRouteList, '')
    assert.deepEqual(duplicates, [])
  })

  it('主导航的每个模块都有可点的入口（显示或单页模块；暂时隐藏的除外）', () => {
    // 真正的目标：页面不能是"路由可达但无处可点"。两种满足方式——
    // 多页模块：children 里有可见页面（容器会呈现为可点单项）；
    // 单页模块（当前的「系统设置」）：没有容器，页面本身就是模块入口，
    // 图标栏那一项直接点得进（`MainSidebar` 只要求 children 非空），因此页面可以保持隐藏。
    const unreachable: string[] = []
    const hidden: string[] = []
    for (const group of menuRouteList) {
      if (group.meta.menu === false) {
        hidden.push(group.meta.title)
        continue
      }
      const children = group.children ?? []
      const reachable = {
        visiblePage: flatten(children).some(item => item.meta.menu !== false),
        flatSinglePageModule: children.length === 1 && !!children[0]!.component,
      }
      if (!reachable.visiblePage && !reachable.flatSinglePageModule) {
        unreachable.push(group.meta.title)
      }
    }
    assert.deepEqual(
      unreachable,
      [],
      `以下模块在侧边栏里没有任何可点入口，页面只能靠内部按钮到达：\n${unreachable.join('、')}`,
    )
    // 隐藏名单与实现必须一致：多藏一个会让人以为入口丢了，少藏一个会留下点了没反应的入口
    assert.deepEqual(
      [...hidden].sort(),
      [...TEMPORARILY_HIDDEN_MODULES].sort(),
      `实际隐藏的模块与名单不一致。实际：${hidden.join('、') || '(无)'}`,
    )
  })

  it('暂时隐藏的模块仍然可访问，只是不在菜单里', () => {
    for (const title of TEMPORARILY_HIDDEN_MODULES) {
      const group = menuRouteList.find(item => item.meta.title === title)
      assert.ok(group, `隐藏名单里的「${title}」在菜单数据里不存在`)
      assert.equal(group.meta.menu, false, `「${title}」应当以 menu: false 隐藏，而不是被删掉`)
      // 路由与页面组件都还在：恢复时删掉 menu: false 即可，不必重新接线
      assert.ok((group.children ?? []).length > 0, `「${title}」的路由不该被一并删掉`)
      assert.ok(
        collectPages().some(item => item.meta.title === title),
        `「${title}」的页面组件应当仍然接线，恢复菜单时不需要重新找文件`,
      )
    }
  })

  it('系统设置以页面本身作模块入口：没有容器，页面上也不再出现第二个同名项', () => {
    const systemGroup = menuRouteList.find(item => item.meta.title === '系统设置')
    assert.ok(systemGroup, '应当存在「系统设置」菜单组')

    // 曾经的 bug：模块与子页面各画一个「系统设置」。原因是有 Layout 容器 + 同名子页面两层，
    // 而 `MainSidebar` 取 `children[0].meta.title` 作图标栏（hover）文字——它同样是「系统设置」。
    // 现在只有页面这一项，且它 `menu: false`：侧边栏里只留图标栏那一处，二级导航不再画同名项。
    const entries = systemGroup.children ?? []
    assert.deepEqual(
      entries.map(item => item.meta.title),
      ['系统设置'],
      `「系统设置」模块下应当只有页面这一项，实际：${entries.map(item => item.meta.title).join('、')}`,
    )
    assert.equal(
      entries[0]!.component,
      'system/settings.vue',
      '模块的唯一入口应当是系统设置页本身，而不是 Layout 容器',
    )
    assert.equal(
      entries[0]!.meta.menu,
      false,
      '单页模块的页面必须保持 menu: false，否则二级导航会画出第二个「系统设置」',
    )
    assert.equal(
      entries[0]!.meta.auth,
      SYSTEM_MANAGE_PERMISSION,
      '系统设置承载端口、更新与自检，应当是管理权限',
    )
    assert.equal(
      entries[0]!.meta.activeMenu,
      FRONTEND_ROUTE_PATHS.systemSettings,
      '设置页的 activeMenu 要与前端路径常量一致，否则侧边栏高亮会失效',
    )
    // 面包屑会依次渲染 route.matched 里每一层，这一层必须关掉，否则出现「首页 / 系统设置 / 系统设置」
    assert.equal(
      entries[0]!.meta.breadcrumb,
      false,
      '子页面与模块同名时必须隐藏自己的面包屑，否则面包屑会重复一层',
    )
    assert.equal(
      flatten(entries).some(item => item.component === 'Layout'),
      false,
      '系统设置只有一页，不需要 Layout 容器：容器与子页面同名会再画一个「系统设置」',
    )

    const legacyNamedPages = collectPages().filter(item => item.meta.title === '面板设置')
    assert.deepEqual(
      legacyNamedPages.map(item => item.meta.title),
      [],
      '二级菜单里的「面板设置」应当已被取消，页面标题统一为「系统设置」',
    )
  })

  it('商业支持是独立的主导航模块，插件页面保留但暂从菜单隐藏', () => {
    const topTitles = menuRouteList.map(item => item.meta.title)
    assert.ok(
      topTitles.includes('商业支持与 Pro'),
      `「商业支持与 Pro」应当是主导航模块，实际顶级模块：${topTitles.join('、')}`,
    )
    // 插件仍在菜单数据里（页面可访问），但模块入口暂时收起——见 TEMPORARILY_HIDDEN_MODULES
    assert.ok(topTitles.includes('插件'), `「插件」的模块数据不应当被删掉，实际顶级模块：${topTitles.join('、')}`)

    const pages = collectPages()
    const plugins = pages.find(item => item.meta.title === '插件')
    assert.ok(plugins, '应当存在「插件」页面')
    assert.equal(plugins.meta.auth, SYSTEM_MANAGE_PERMISSION, '启停插件是管理动作，应当是管理权限')

    const commercial = pages.find(item => item.meta.title === '商业支持与 Pro')
    assert.ok(commercial, '应当存在「商业支持与 Pro」页面')
    // 详情接口只要 system:read，菜单若要求管理权限，只读账号就会看不到自己的授权状态
    assert.equal(commercial.meta.auth, SYSTEM_READ_PERMISSION, '授权状态是只读信息，应当是只读权限')
  })

  it('独立模块的路由路径与前端常量一致', () => {
    const pages = collectPages()
    const commercial = pages.find(item => item.meta.title === '商业支持与 Pro')
    const plugins = pages.find(item => item.meta.title === '插件')
    assert.equal(commercial?.meta.activeMenu, FRONTEND_ROUTE_PATHS.commercial)
    assert.equal(plugins?.meta.activeMenu, FRONTEND_ROUTE_PATHS.plugins)
    assert.equal(FRONTEND_ROUTE_PATHS.plugins, '/plugins')
    assert.equal(FRONTEND_ROUTE_PATHS.commercial, '/commercial')
    // 旧路径仍在常量表里：前端静态重定向拿它把 /system/notify 引到设置页的通知渠道 tab
    assert.equal(FRONTEND_ROUTE_PATHS.systemNotify, '/system/notify')
  })
})
