import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import pinia from '@/store'
import { FRONTEND_ROUTE_PATHS } from '../../shared/constants/frontend-routes'

/** 旧路径重定向（书签/外链兼容） */
const legacyRouteRedirects: RouteRecordRaw[] = [
  { path: '/cluster', redirect: '/games/dst/rooms' },
  { path: '/cluster/list', redirect: '/games/dst/rooms' },
  {
    path: '/cluster/settings/:instanceId',
    redirect: to => ({
      path: `/games/dst/rooms/${String(to.params.instanceId)}/settings`,
    }),
  },
  { path: '/cluster/shard-list', redirect: '/games/dst/worlds' },
  {
    path: '/cluster/shard-settings/:instanceId',
    redirect: to => ({
      path: `/games/dst/worlds/${String(to.params.instanceId)}/settings`,
    }),
  },
  /**
   * 菜单重排后的旧地址（书签、CHANGELOG 与历史文档里的链接都指向它们）：
   * 通知渠道是设置页的页内 tab，「插件」与「商业支持与 Pro」升级为一级菜单。
   * `?tab=notify` 只在设置页挂载时被读取一次，随后由页面自己把地址栏抹干净。
   */
  {
    path: '/system/notify',
    redirect: to => ({
      path: FRONTEND_ROUTE_PATHS.systemSettings,
      query: { ...to.query, tab: 'notify' },
    }),
  },
  { path: '/system/plugins', redirect: FRONTEND_ROUTE_PATHS.plugins },
  { path: '/system/commercial', redirect: FRONTEND_ROUTE_PATHS.commercial },
]

// 固定路由（默认路由）
const constantRoutes: RouteRecordRaw[] = [
  ...legacyRouteRedirects,
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login.vue'),
    meta: {
      title: '登录',
    },
  },
  {
    path: '/force-change-password',
    name: 'forceChangePassword',
    component: () => import('@/views/force-change-password.vue'),
    meta: {
      title: '修改初始密码',
    },
  },
  {
    path: '/:all(.*)*',
    name: 'notFound',
    component: () => import('@/views/[...all].vue'),
    meta: {
      title: '找不到页面',
    },
  },
]

// 系统路由
const systemRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/index.vue'),
    meta: {
      breadcrumb: false,
    },
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/views/index.vue'),
        meta: {
          title: useAppSettingsStore(pinia).settings.app.home.title,
          icon: 'i-ant-design:home-twotone',
          breadcrumb: false,
        },
      },
      {
        path: 'reload',
        name: 'reload',
        component: () => import('@/views/reload.vue'),
        meta: {
          title: '重新加载中...',
          breadcrumb: false,
        },
      },
    ],
  },
]

// 动态路由（异步路由、导航菜单路由）
const asyncRoutes: RouteRecordMainRaw[] = []

export {
  asyncRoutes,
  constantRoutes,
  systemRoutes,
}
