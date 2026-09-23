import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import { createRouterMatcher } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { FRONTEND_ROUTE_PATHS } from '../../../../shared/constants/frontend-routes.ts'
import { resolveRoutePath } from '../../../utils/index.ts'
import { menuRouteList } from '../../../../server/src/shared/menu-routes.ts'
import { flattenModuleChildrenForSingleMode } from './menu-flatten.ts'
import {
  isRouteOnlyLayoutContainer,
  isSinglePageModule,
  mountLayoutForSinglePageModules,
} from './route-layout.ts'

/**
 * 页面必须挂在布局容器下。
 *
 * 背景：布局不是靠前端约定，而是靠路由嵌套——`src/router/routes.ts` 里只有 `/` 一条
 * Layout 路由，页面必须是它的子路由才会渲染出侧栏与顶栏。而后端菜单数据里「系统设置」
 * 是一个**没有容器**的单页模块（为修掉侧栏两个同名入口而改的），它的页面是绝对路径，
 * 直接注册就成了顶层路由：进入这一页后整条左侧栏与顶栏都不渲染。
 *
 * 这里钉住五件事：
 *   1. 单页模块会被补上容器，且**地址不变**（子路由走相对空路径）；
 *   2. 容器确实处于页面与布局之间（vue-router 解析出两层），这是「侧栏在不在」的判定依据；
 *   3. 多页模块（后端本来就写了 `component: 'Layout'`）逐字段不变，不重复包装；
 *   4. 模块级 `menu: false`（暂时隐藏的「插件」）保持原样，菜单层继续按老规矩过滤；
 *   5. 补出来的容器在菜单里被跳过：侧栏仍然只有一处「系统设置」。
 */

/** 真实菜单数据里的系统设置模块（单页、绝对路径、没有容器） */
const systemModule = menuRouteList.find(module => module.meta.title === '系统设置') as unknown as RouteRecordMainRaw

/** 合成的多页模块：`Layout` 容器 + 相对路径子页面 */
const multiPageModule = {
  meta: { title: '实例管理', icon: 'ri:stack-line' },
  children: [{
    path: '/node',
    component: 'Layout',
    redirect: FRONTEND_ROUTE_PATHS.nodeInstance,
    meta: { title: '实例管理', auth: 'pages.node.instance:manage' },
    children: [{
      path: 'instance',
      name: 'nodeInstance',
      component: 'node/instance/index.vue',
      meta: { title: '实例管理', menu: false, activeMenu: FRONTEND_ROUTE_PATHS.nodeInstance },
    }],
  }],
} as unknown as RouteRecordMainRaw

/** 合成的隐藏模块：模块级 `menu: false`（「插件」的形状），路由仍在、只是入口收起 */
const hiddenModule = {
  meta: { title: '插件', icon: 'ri:plug-line', menu: false },
  children: [{
    path: FRONTEND_ROUTE_PATHS.plugins,
    component: 'Layout',
    meta: { title: '插件', auth: 'system:manage' },
    children: [{ path: '', name: 'systemPlugins', component: 'system/plugins.vue', meta: { title: '插件' } }],
  }],
} as unknown as RouteRecordMainRaw

/**
 * 布局组件占位符。
 *
 * 生产代码把真实的 `() => import('@/layouts/index.vue')` 传进注入函数；单测里换成字符串
 * 占位：真实布局组件一旦被加载会拖进 `virtual:fantastic-admin/*`（只有 Vite 能解析），
 * 而这里只需要断言「容器上的 component 是调用方传进来的那个」。
 */
const LAYOUT_STUB = 'LayoutStub' as unknown as RouteRecordRaw['component']

/** 取模块下的第一层子项（容器或页面） */
function firstChild(module: RouteRecordMainRaw) {
  const child = module.children![0] as unknown as RouteRecordRaw
  assert.ok(child, '模块下应当有子项')
  return child
}

describe('单页模块的布局容器', () => {
  it('单页模块被补上容器，且子页面走相对空路径（地址不漂移）', () => {
    assert.ok(systemModule, '菜单数据里应当有系统设置模块')
    assert.equal(
      (systemModule as { path?: string }).path,
      undefined,
      '真实菜单数据里单页模块自身没有 path，容器路径要由页面路径推导',
    )

    const [mounted] = mountLayoutForSinglePageModules([systemModule], LAYOUT_STUB)
    const container = firstChild(mounted!)

    assert.equal(mounted!.children!.length, 1, '单页模块下应当只剩容器这一项')
    assert.equal(container.path, FRONTEND_ROUTE_PATHS.systemSettings, '容器用页面的绝对路径')
    assert.equal(
      container.component,
      LAYOUT_STUB,
      '容器必须带上真正的布局组件——写字符串 `Layout` 会让 vue-router 报 "not a valid component"，'
      + '这一页就会整个打不开（注册发生在 formatBackRoutes 之后，没人再翻译那个字符串）',
    )
    assert.equal(container.meta?.menu, false, '容器不该在侧栏占一格')
    assert.equal(container.meta?.layoutContainer, true, '容器要能被菜单层识别出来')

    const page = container.children![0]!
    assert.equal(page.path, '', '子页面用相对空路径挂载，解析结果仍是模块自身的绝对路径')
    assert.equal(page.component, 'system/settings.vue', '页面组件不能被换掉')
    assert.equal(page.meta?.auth, 'system:manage', '页面的权限点必须原样保留')
    assert.equal(page.meta?.activeMenu, FRONTEND_ROUTE_PATHS.systemSettings, '侧栏高亮依赖 activeMenu')

    // 容器路径 + 空路径子路由 = `resolveRoutePath` 给出的这条路径，仍是原地址
    assert.equal(
      resolveRoutePath(container.path, page.path),
      FRONTEND_ROUTE_PATHS.systemSettings,
      '菜单项与地址都不能漂移',
    )
  })

  it('vue-router 把这条路由解析成「容器 + 页面」两层（侧栏在不在就看这个）', () => {
    // 复刻 `routes` 计算属性的注册整理：容器保留组件、叶子去掉空的 children
    const walk = (item: RouteRecordRaw): RouteRecordRaw => {
      if (item.children?.length) {
        item.children = item.children.map(walk)
      }
      else {
        delete item.children
      }
      return item
    }
    const mounted = mountLayoutForSinglePageModules([systemModule], LAYOUT_STUB)
    const routes = mounted.flatMap(route => (route.children ?? []) as RouteRecordRaw[]).map(walk)
    const matcher = createRouterMatcher(routes, {})

    const matched = matcher.resolve({ path: FRONTEND_ROUTE_PATHS.systemSettings }, undefined!)?.matched ?? []

    assert.equal(matched.length, 2, `应当匹配到「容器 + 页面」两层，实际 ${matched.length} 层：${JSON.stringify(matched.map(m => m.path))}`)
    assert.equal(matched[0]!.path, FRONTEND_ROUTE_PATHS.systemSettings, '外层是布局容器')
    assert.equal(matched[0]!.components?.default, LAYOUT_STUB, '最外层必须是布局组件')
    assert.equal(matched.at(-1)!.components?.default, 'system/settings.vue', '最内层是设置页本身')
  })

  it('多页模块逐字段不变，不会被重复包装', () => {
    const [mounted] = mountLayoutForSinglePageModules([multiPageModule], LAYOUT_STUB)
    assert.deepEqual(JSON.parse(JSON.stringify(mounted)), JSON.parse(JSON.stringify(multiPageModule)))
  })

  it('模块级 menu: false（暂时隐藏的插件）保持原样', () => {
    const [mounted] = mountLayoutForSinglePageModules([hiddenModule], LAYOUT_STUB)
    assert.deepEqual(JSON.parse(JSON.stringify(mounted)), JSON.parse(JSON.stringify(hiddenModule)))
    assert.equal(isSinglePageModule(hiddenModule), false, '模块级 menu: false 不属于「单页模块」')
  })

  it('补容器不就地改写传入的路由数据', () => {
    const routes = [systemModule, multiPageModule, hiddenModule]
    const before = JSON.stringify(routes)
    mountLayoutForSinglePageModules(routes, LAYOUT_STUB)
    assert.equal(JSON.stringify(routes), before, '路由数据是共享单例，注入必须复制对象')
  })

  it('只有注入的容器会被菜单层跳过（不能凭 menu: false 误伤被隐藏的页面）', () => {
    const [mounted] = mountLayoutForSinglePageModules([systemModule], LAYOUT_STUB)
    const container = firstChild(mounted!)

    assert.equal(isRouteOnlyLayoutContainer(container), true, '注入出来的容器应当被识别')
    assert.equal(
      isRouteOnlyLayoutContainer(firstChild(hiddenModule)),
      false,
      '后端菜单数据里的 Layout 容器没有这个标记——它在菜单里靠模块级 menu: false 整块隐藏',
    )
    assert.equal(
      isRouteOnlyLayoutContainer({ path: '/x', component: 'x.vue', meta: { menu: false } } as unknown as RouteRecordRaw),
      false,
      '被隐藏的**叶子页面**不是容器，不能因为 menu: false 就被菜单层跳过（否则页面入口会消失）',
    )
    assert.equal(systemModule.meta?.menu, undefined, '菜单数据里的模块级 menu 不该被注入逻辑改动')
  })
})

describe('单页模块在菜单里仍然只有一处入口', () => {
  it('侧栏平铺后只有一个「系统设置」，不出现容器与页面两个同名项', () => {
    assert.ok(systemModule, '菜单数据里应当有系统设置模块')

    // 菜单层拿到的仍是没有容器的模块（容器只在路由层被补出来）
    const menus = flattenModuleChildrenForSingleMode(
      systemModule.children ?? [],
      systemModule.path ?? '',
      'single',
      systemModule.meta.title,
    )

    assert.equal(menus.length, 1, '系统设置模块下只应有一个侧栏项')
    assert.equal(menus[0]!.path, FRONTEND_ROUTE_PATHS.systemSettings, '入口指向设置页')
    assert.notEqual(menus[0]!.meta?.menu, false, '这个入口必须是可见项')
    assert.equal(
      isRouteOnlyLayoutContainer(systemModule as unknown as RouteRecordRaw),
      false,
      '菜单数据里的模块不是「纯容器层」，不该被菜单层跳过',
    )
  })
})
