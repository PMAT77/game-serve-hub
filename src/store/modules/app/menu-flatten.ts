import type { MenuRecordRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { resolveRoutePath } from '@/utils'
import { isRouteOnlyLayoutContainer } from './route-layout'
import type { MenuRouteItemLike } from './route-layout'

/** 菜单布局模式（与 `packages/settings` 的 `MenuMode` 一致） */
export type MenuLayoutMode = 'side' | 'head' | 'single'

/**
 * 单栏（`single`）菜单模式下，把一个模块的子项平铺进唯一的菜单组。
 *
 * 为什么需要这一步：单页模块（后端 `menuRouteList` 里「系统设置」那种——模块下只有一个
 * 页面，且页面自身 `meta.menu: false`）的入口是**图标栏那一项**，页面故意保持隐藏，
 * 否则 side 模式下图标栏与二级导航会各画一个同名入口（那是一次已修过的回归）。
 * 但 `single` 模式不渲染图标栏（见 `src/layouts/index.vue` 的 `isMainSidebarEnable`），
 * 侧栏只画平铺出来的子项，于是这些页面被 `Menu/index.vue` 的 `menu === false` 过滤掉，
 * **整个模块在侧栏里一个入口都不剩**——左侧菜单里就这么少了「系统设置」。
 *
 * 所以这里只对「全部直接子项都隐藏」的模块把子项标记为可见，并用模块标题作入口文字
 * （侧栏显示的是模块名，页面 `meta.title` 改名不该让入口文字漂移）。其他模块原样递归，
 * 多页模块与暂时隐藏的模块（模块级 `menu: false`，在 `convertRouteToMenu` 里就被丢掉）
 * 的行为完全不变；side / head 模式也不经过这里 flatten 之外的任何改动。
 */
export function flattenModuleChildrenForSingleMode(
  children: RouteRecordRaw[],
  basePath: string,
  mode: MenuLayoutMode,
  moduleTitle?: string | (() => string),
): MenuRecordRaw[] {
  /**
   * 路由层给单页模块补出来的布局容器（`route-layout.ts` 的 `mountLayoutForSinglePageModules`）
   * 在菜单里是**透明层**：它只为让页面落进 `layouts/index.vue`，入口必须由页面自己承担。
   *
   * 不剥掉的话，单栏模式的侧栏会多出一个「可展开、展开后为空」的项——`Menu/index.vue` 按
   * `children.length` 把它渲染成 `SubMenu`，而 `initItems` 又按「有可见子项」把它登记成叶子项，
   * 两边对不上；何况容器本身没有面向用户的标题与图标。
   */
  const unwrapped = unwrapInjectedLayoutContainer(children, basePath)
  const pages = unwrapped.children
  const singlePageModule = mode === 'single'
    && pages.length > 0
    && pages.every(item => item.meta?.menu === false)

  const menus = convertRouteToMenuRecursive(pages, unwrapped.basePath)
  if (!singlePageModule) {
    return menus
  }

  // 必须复制对象：`convertRouteToMenuRecursive` 里的 meta 是原对象引用，就地改写会污染
  // 后端菜单数据，进而让 side 模式重新出现两个同名入口。
  return menus.map(menu => ({
    ...menu,
    meta: {
      ...menu.meta,
      menu: true as const,
      title: resolveMenuTitle(moduleTitle ?? menu.meta?.title),
    },
  }))
}

/**
 * 剥掉 `mountLayoutForSinglePageModules` 注入的布局容器，返回真正的页面项与它们该用的 basePath。
 *
 * 容器路径就是页面原有的绝对路径（注入时按它建的容器），子页面则用相对空路径挂载——
 * 所以 basePath 必须换成容器路径，否则菜单项的 path 会解析成空串、点进去无处可去。
 */
function unwrapInjectedLayoutContainer(
  children: RouteRecordRaw[],
  basePath: string,
): { children: RouteRecordRaw[], basePath: string } {
  const container = children.length === 1 ? children[0] : undefined
  if (!container || !isRouteOnlyLayoutContainer(container as unknown as MenuRouteItemLike)) {
    return { children, basePath }
  }
  return {
    children: container.children ?? [],
    basePath: container.path ?? basePath,
  }
}

/**
 * 菜单项文字归一化：`RouteMetaRaw.title` 允许函数式动态标题（`string | (() => string)`），
 * 而菜单项 meta 只接受字符串。调用方（以及未来接手的调用方）漏掉这一步时，
 * 这里兜住，别把函数本身当成标题渲染出去。
 */
function resolveMenuTitle(title: string | (() => string) | undefined) {
  return typeof title === 'function' ? title() : title
}

/** 将原始路由的子项转换成菜单项（`meta` 保留引用，供 `convertRouteToMenu` 做模块级过滤） */
export function convertRouteToMenuRecursive(routes: RouteRecordRaw[], basePath = ''): MenuRecordRaw[] {
  const returnMenus: MenuRecordRaw[] = []
  routes.forEach((item) => {
    const menuItem: MenuRecordRaw = {
      path: resolveRoutePath(basePath, item.path),
      meta: {
        auth: item?.meta?.auth,
        title: item?.meta?.title,
        icon: item?.meta?.icon,
        menu: item?.meta?.menu,
        expand: item?.meta?.expand,
        link: item?.meta?.link,
      },
    }
    if (item.children) {
      menuItem.children = convertRouteToMenuRecursive(item.children, menuItem.path)
    }
    returnMenus.push(menuItem)
  })
  return returnMenus
}
