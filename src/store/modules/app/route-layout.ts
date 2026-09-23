import type { RouteComponent } from 'vue-router'

/**
 * 后端路由数据整形与单页模块的布局容器注入（纯函数）。
 *
 * 这些函数刻意不放在 store 里：`route.ts` 会拉进请求层（`@/api` → `@/router` → `guards`
 * → `virtual:fantastic-admin/turbo-console`），而虚拟模块只有 Vite 能解析，单测里导入
 * store 会直接 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。放在这里既好测，也让「路由结构整形」
 * 与「store 接线」各归各位。
 *
 * 这里用自己的一小套类型、而不是 `vue-router` 的 `RouteRecordRaw`：后端菜单数据在这个
 * 阶段本来就是「字符串 component + meta 带 menu」的形状——那是 `RouteRecordRaw` 明确
 * 不允许的（它的 component 是 `RawRouteComponent`）。
 */

/** 菜单/路由项的 meta（后端菜单数据与前端页面的并集，字段都按需声明以免与框架类型冲突） */
export interface MenuRouteMetaLike {
  title?: string
  icon?: string
  auth?: string | string[]
  sort?: number
  /** 是否在菜单里渲染这一项；容器与「单页模块的页面」都会标 `false` */
  menu?: boolean
  /**
   * 布局容器标记：由 `mountLayoutForSinglePageModules` 注入。
   *
   * 用标记而不是「`component === 'Layout'`」来判定容器：容器在注册前会被换成真正的
   * 布局组件（懒加载函数），字符串形态只在后端原始数据里出现——靠字符串比较判定的
   * 第一版修复因此在注册后把所有容器都判成「不是容器」。
   */
  layoutContainer?: boolean
  expand?: boolean
  link?: string
  activeMenu?: string
  breadcrumb?: boolean
  keepAlive?: boolean
}

/** 菜单/路由项（`formatBackRoutes` 之后 component 已是组件） */
export interface MenuRouteItemLike {
  path?: string
  name?: string
  component?: RouteComponent | null
  redirect?: string
  meta?: MenuRouteMetaLike
  children?: MenuRouteItemLike[]
}

/** 顶级模块（菜单分组） */
export interface MenuRouteModuleLike extends MenuRouteItemLike {
  children: MenuRouteItemLike[]
}

/**
 * 后端菜单数据的原始形状：`component` 在这一步还是字符串（`'Layout'`，或 `views/` 下的相对路径）。
 *
 * 单独声明而不是复用 `MenuRouteItemLike`：后者按 vue-router 的要求把 `component` 定成
 * `RouteComponent`，字符串在那里表达不出来，判定「是不是 `'Layout'`」就成了「无重叠比较」，
 * 只剩断言一条路。
 */
export interface BackendRouteItemLike {
  path?: string
  name?: string
  component?: RouteComponent | string | null
  redirect?: string
  meta?: MenuRouteMetaLike
  children?: BackendRouteItemLike[]
}

/** `buildRoutesFromBackend` 需要从外面拿到的东西：页面组件表与布局组件 */
export interface BackendRoutesContext {
  /** `import.meta.glob` 扫 `@/views` 目录得到的页面组件表，把 `'system/settings.vue'` 映射成组件 */
  views: Record<string, RouteComponent | undefined>
  /** 真实的布局组件（`() => import('@/layouts/index.vue')`） */
  layout: RouteComponent
}

/**
 * 判断一个路由项是不是布局容器层。
 *
 * 容器是为「页面必须挂在布局容器下」这条约束补出来的（见 `mountLayoutForSinglePageModules`），
 * 本身不该在侧栏占一格：它的可见性由子页面决定。
 */
export function isRouteOnlyLayoutContainer(route: MenuRouteItemLike) {
  return route.meta?.layoutContainer === true
}

/**
 * 模块的「直接叶子页面」：没有 children、component 已接线、且路径是绝对路径。
 *
 * 判定刻意**不看 component 的类型**。第一版要求它是字符串（后端原始数据确实如此），
 * 但唯一的调用方 `buildRoutesFromBackend` 先跑 `formatBackRoutes`——那时字符串早已被换成
 * 懒加载组件函数，判定在真实链路上永远为 `false`：容器注入变成空操作，`/system/settings`
 * 仍按顶层路由注册，页面自渲染而不经过 `layouts/index.vue`，于是进入这一页后左侧菜单栏、
 * 顶栏、标签栏整条不渲染（用户看到的就是「进设置页后菜单栏没了」）。
 *
 * 路径要求绝对路径也有原因：单页模块自身没有 `path`，容器路径只能由子项推导，
 * 相对路径推出来的路由注册不上去——宁可不注入，也不猜。
 */
function isDirectLeafPage(page: MenuRouteItemLike) {
  return !!page.component
    && !page.children?.length
    && typeof page.path === 'string'
    && page.path.startsWith('/')
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
    && pages.every(page => isDirectLeafPage(page))
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
 * 就写着，并且会被 `formatBackRoutes` 翻译成组件），这里逐项原样返回，绝不重复包装；
 * 模块级 `menu: false`（暂时隐藏的「插件」）也保持原样，让菜单层继续整块过滤掉。
 *
 * 容器的 `meta` 从页面继承，只覆盖 `menu` 与 `layoutContainer` 两项：容器对用户不可见，
 * 但面包屑、标签栏仍要能读到标题；`breadcrumb: false` 之类也随页面一并生效，
 * 免得面包屑里多出一层同名层级。
 *
 * `layout` 由调用方注入真实的布局组件（`() => import('@/layouts/index.vue')`）：这个补丁
 * 发生在 `formatBackRoutes` **之后**，那时 `'Layout'` 字符串已经没人再翻译，写字符串会让
 * vue-router 报 `Component "default" in record with path "/system/settings" is not a valid
 * component. Received "Layout"`。反过来，纯函数里若自己 import 布局组件，单测会连带加载
 * `virtual:fantastic-admin/*` 而跑不起来——所以组件从外面传进来。
 */
export function mountLayoutForSinglePageModules<T extends MenuRouteModuleLike>(
  routes: T[],
  layout: RouteComponent,
): T[] {
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
        component: layout,
        meta: { ...module.children[0]?.meta, menu: false, layoutContainer: true },
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

/**
 * 后端菜单数据 → 可直接注册的路由：**先翻译 component，再补布局容器**。
 *
 * 顺序只有这一处，既不拆开调用也不反过来：
 * - 反过来（先补容器再翻译）会让容器的组件被 `views['/src/views/' + 函数]` 换成
 *   `undefined`，vue-router 判定「不是有效组件」，这一页整个打不开；
 * - 拆开、由调用方分别调用（第一版就是这样）时，只要有人调整两行的先后，注入就会
 *   看到已经格式化过的数据而静默失效——`isDirectLeafPage` 的判定与这里的顺序是一对，
 *   由 `route.test.ts` 的「真实顺序」用例钉住。
 *
 * 就地改写传入的 `routes`（后端刚返回的 JSON，没有第二处持有者），与旧实现一致。
 */
export function buildRoutesFromBackend(
  routes: BackendRouteItemLike[],
  context: BackendRoutesContext,
): MenuRouteModuleLike[] {
  formatBackRoutes(routes, context)
  return mountLayoutForSinglePageModules(
    routes as unknown as MenuRouteModuleLike[],
    context.layout,
  )
}

/** 把字符串 component 翻译成真正的组件：`'Layout'` → 布局组件，相对路径 → `views/` 下的页面 */
function formatBackRoutes(routes: BackendRouteItemLike[], context: BackendRoutesContext): BackendRouteItemLike[] {
  return routes.map((route) => {
    if (route.component === 'Layout') {
      route.component = context.layout
    }
    else if (typeof route.component === 'string') {
      route.component = context.views[`/src/views/${route.component}`]
    }
    else if (!route.component) {
      delete route.component
    }
    if (route.children) {
      route.children = formatBackRoutes(route.children, context)
    }
    return route
  })
}
