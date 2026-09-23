/**
 * 单页模块的布局容器注入（纯函数）。
 *
 * 这些函数刻意不放在 store 里：`route.ts` 会拉进请求层（`@/api` → `@/router` → `guards`
 * → `virtual:fantastic-admin/turbo-console`），而虚拟模块只有 Vite 能解析，单测里导入
 * store 会直接 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。放在这里既好测，也让「路由结构整形」
 * 与「store 接线」各归各位。
 *
 * 这里用自己的一小套类型、而不是 `vue-router` 的 `RouteRecordRaw`：后端菜单数据（以及
 * 注册前的原始路由）在这个阶段本来就是「字符串 component  + meta 带 menu」的形状——
 * 那是 `RouteRecordRaw` 明确不允许的（它的 component 是 `RawRouteComponent`），硬套会在
 * 比较 `component === 'Layout'` 时被 TS2367 判定为「无意义比较」。转换发生在
 * `formatBackRoutes`（把 `'Layout'` 换成真实组件），那之后的数据结构就交给 vue-router 管。
 */

/** 菜单/路由项的 meta（后端菜单数据与前端页面的并集，字段都按需声明以免与框架类型冲突） */
export interface MenuRouteMetaLike {
  title?: string
  icon?: string
  auth?: string | string[]
  sort?: number
  /** 是否在菜单里渲染这一项；容器与「单页模块的页面」都会标 `false` */
  menu?: boolean
  expand?: boolean
  link?: string
  activeMenu?: string
  breadcrumb?: boolean
  keepAlive?: boolean
}

/** 菜单/路由项（component 此时还是 `views/` 下的相对路径或 `Layout`） */
export interface MenuRouteItemLike {
  path?: string
  name?: string
  component?: string
  redirect?: string
  meta?: MenuRouteMetaLike
  children?: MenuRouteItemLike[]
}

/** 顶级模块（菜单分组） */
export interface MenuRouteModuleLike extends MenuRouteItemLike {
  children: MenuRouteItemLike[]
}

/**
 * 判断一个路由项是不是「布局容器层」——我们注入出来的那种。
 *
 * 形状是 `component: 'Layout'` + `meta.menu: false`：容器本身不该在侧栏占一格，
 * 它的可见性由子页面决定。注意这个判定要在 `formatBackRoutes` **之前**的形态上做
 * （那时 component 还是字符串 `'Layout'`）。
 */
export function isRouteOnlyLayoutContainer(route: MenuRouteItemLike) {
  return route.meta?.menu === false
    && route.component === 'Layout'
}

/**
 * 单页模块：模块下只有一个页面，且没有中间容器层。
 *
 * 当前只有「系统设置」是这样——它的页面按菜单约定标成 `menu: false`
 * （入口由图标栏那一项承担，单栏布局下由菜单层平铺成可见项），
 * 路由数据里因此只有 `{ path, component }` 一项。
 */
export function isSinglePageModule(module: MenuRouteModuleLike) {
  const pages = module.children
  return module.meta?.menu !== false
    && pages.length > 0
    && pages.every(page => !!page.component && page.component !== 'Layout' && !page.children)
}

/**
 * 给单页模块补一层布局容器。
 *
 * 为什么需要：布局不是靠前端约定，而是靠**路由嵌套**——`src/router/routes.ts` 里只有 `/`
 * 一条 Layout 路由（children 是首页与 reload），所以一个页面要在 `layouts/index.vue` 里
 * 渲染，它必须是某条 Layout 路由的子路由。而 `routes` 计算属性会把顶级模块的子项平铺进
 * 路由表：单页模块的子项是绝对路径（`/system/settings`），于是注册成了**顶层路由**，
 * 页面自渲染、左侧栏与顶栏整条不渲染——用户看到的就是「进入系统设置后侧栏消失」。
 *
 * 为什么只补这一种形状：多页模块本来就有 `component: 'Layout'` 的容器（后端菜单数据里
 * 就写着），这里逐项原样返回，绝不重复包装；模块级 `menu: false`（暂时隐藏的「插件」）
 * 也保持原样，让菜单层继续按老规矩把它整块过滤掉。
 *
 * 补出来的容器带 `meta.menu: false`：它只在路由层有意义，菜单层（`convertRouteToMenu`）
 * 会跳过它，避免侧栏出现「容器 + 同页面」两个同名入口。
 */
export function mountLayoutForSinglePageModules<T extends MenuRouteModuleLike>(routes: T[]): T[] {
  return routes.map((module) => {
    if (!isSinglePageModule(module)) {
      return module
    }
    // 真实菜单数据里单页模块**自身没有 path**（`children[0].path` 才是页面的绝对路径，
    // 如 `/system/settings`）。容器必须用这条路径：否则容器会成为无名父层，页面反而
    // 被解析成相对路径。
    const containerPath = typeof module.path === 'string' ? module.path : module.children[0]?.path
    if (typeof containerPath !== 'string') {
      return module
    }
    // 复制而非就地改写：`routesRaw` 同时供路由注册与菜单构建使用，污染共享数据会
    // 让菜单与路由对不齐（这类不一致排查起来极费时间）。
    return {
      ...module,
      children: [{
        path: containerPath,
        component: 'Layout',
        meta: { menu: false },
        children: module.children.map(page => ({
          ...page,
          // 子路由用相对空路径挂载，解析结果仍是这条绝对路径：
          // 地址、书签与深链都不变。
          path: '',
        })),
      }],
    } as unknown as T
  })
}
