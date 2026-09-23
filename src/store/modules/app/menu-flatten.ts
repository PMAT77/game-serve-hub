import type { MenuRecordRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { resolveRoutePath } from '@/utils'

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
  moduleTitle?: string,
): MenuRecordRaw[] {
  const singlePageModule = mode === 'single'
    && children.length > 0
    && children.every(item => item.meta?.menu === false)

  const menus = convertRouteToMenuRecursive(children, basePath)
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
      title: moduleTitle ?? menu.meta?.title,
    },
  }))
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
