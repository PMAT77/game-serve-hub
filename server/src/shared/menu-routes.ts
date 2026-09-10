import type { RouteMetaRaw } from '../../../packages/types/types'
import { FRONTEND_ROUTE_PATHS } from '../../../shared/constants/frontend-routes'

/** 与前端 `vue-router` RouteMeta（RouteMetaRaw）对齐 */
export type MenuRouteMeta = RouteMetaRaw & {
  title: string
}

export interface MenuRouteItem {
  path?: string
  component?: string
  name?: string
  /** vue-router 重定向（用于「单页组」的 Layout 容器直达页面） */
  redirect?: string
  meta: MenuRouteMeta
  children?: MenuRouteItem[]
}

export const NODE_INSTANCE_MANAGE_PERMISSION = 'pages.node.instance:manage'
export const SYSTEM_READ_PERMISSION = 'system:read'
export const SYSTEM_MANAGE_PERMISSION = 'system:manage'
export const OPS_READ_PERMISSION = 'ops:read'
export const OPS_MANAGE_PERMISSION = 'ops:manage'

/**
 * 后端驱动的动态菜单与路由（component 为 views/ 下相对路径）。
 *
 * 菜单组织约定（扁平化，杜绝「控制台>控制台>监控台」式同名嵌套）：
 * - 主导航（图标栏）每一项对应一个页面任务：监控台 / 实例管理 / 房间管理 / 世界管理 / 模组管理 / 系统设置；
 * - 页面路由挂在 Layout 容器下（component: 'Layout'），真实页面 `meta.menu: false` 使容器在菜单中呈现为可点击的单项；
 * - 容器用 redirect 指向真实页面；列表页 `meta.breadcrumb: false` 避免与容器标题重复；
 * - 房间/世界/Mod 的设置页保持隐藏路由（menu: false），面包屑正常展示，activeMenu 归属列表项。
 */
export const menuRouteList: MenuRouteItem[] = [
  {
    meta: {
      title: '监控台',
      icon: 'ri:pulse-line',
    },
    children: [
      {
        path: '/console',
        component: 'Layout',
        name: 'console',
        redirect: '/console/monitor',
        meta: {
          title: '监控台',
          icon: 'ri:pulse-line',
        },
        children: [
          {
            path: 'monitor',
            name: 'consoleMonitor',
            component: 'console/monitor/index.vue',
            meta: {
              title: '监控台',
              icon: 'ri:pulse-line',
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.consoleMonitor,
              keepAlive: true,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '实例管理',
      icon: 'ri:stack-line',
    },
    children: [
      {
        path: '/node',
        component: 'Layout',
        name: 'node',
        redirect: FRONTEND_ROUTE_PATHS.nodeInstance,
        meta: {
          title: '实例管理',
          icon: 'ri:stack-line',
          auth: NODE_INSTANCE_MANAGE_PERMISSION,
        },
        children: [
          {
            path: 'instance',
            name: 'nodeInstance',
            component: 'node/instance/index.vue',
            meta: {
              title: '实例管理',
              icon: 'ri:stack-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.nodeInstance,
            },
          },
          {
            path: 'instance/detail/:instanceId',
            name: 'nodeInstanceDetail',
            component: 'node/instance/detail.vue',
            meta: {
              title: '实例详情',
              icon: 'ri:stack-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              activeMenu: FRONTEND_ROUTE_PATHS.nodeInstance,
              menu: false,
              keepAlive: true,
            },
          },
          {
            path: 'instance/console/:instanceId',
            name: 'nodeInstanceConsole',
            component: 'node/instance/console.vue',
            meta: {
              title: '实例控制台',
              icon: 'ri:terminal-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              activeMenu: FRONTEND_ROUTE_PATHS.nodeInstance,
              menu: false,
              keepAlive: true,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '房间管理',
      icon: 'ri:home-wifi-line',
    },
    children: [
      {
        path: FRONTEND_ROUTE_PATHS.dstRooms,
        component: 'Layout',
        name: 'dstRooms',
        meta: {
          title: '房间管理',
          icon: 'ri:home-wifi-line',
          auth: NODE_INSTANCE_MANAGE_PERMISSION,
        },
        children: [
          {
            path: '',
            name: 'dstRoomList',
            component: 'games/dst/cluster/index.vue',
            meta: {
              title: '房间管理',
              icon: 'ri:home-wifi-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.dstRooms,
            },
          },
          {
            path: ':instanceId/settings',
            name: 'dstRoomSettings',
            component: 'games/dst/cluster/settings.vue',
            meta: {
              title: '房间设置',
              icon: 'ri:settings-3-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              activeMenu: FRONTEND_ROUTE_PATHS.dstRooms,
              menu: false,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '世界管理',
      icon: 'ri:earth-line',
    },
    children: [
      {
        path: FRONTEND_ROUTE_PATHS.dstWorlds,
        component: 'Layout',
        name: 'dstWorlds',
        meta: {
          title: '世界管理',
          icon: 'ri:earth-line',
          auth: NODE_INSTANCE_MANAGE_PERMISSION,
        },
        children: [
          {
            path: '',
            name: 'dstWorldList',
            component: 'games/dst/shard/index.vue',
            meta: {
              title: '世界管理',
              icon: 'ri:earth-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.dstWorlds,
            },
          },
          {
            path: ':instanceId/settings',
            name: 'dstWorldSettings',
            component: 'games/dst/shard/settings.vue',
            meta: {
              title: '世界设置',
              icon: 'ri:landscape-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              activeMenu: FRONTEND_ROUTE_PATHS.dstWorlds,
              menu: false,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '模组管理',
      icon: 'ri:puzzle-line',
    },
    children: [
      {
        path: FRONTEND_ROUTE_PATHS.dstMods,
        component: 'Layout',
        name: 'dstMods',
        meta: {
          title: '模组管理',
          icon: 'ri:puzzle-line',
          auth: NODE_INSTANCE_MANAGE_PERMISSION,
        },
        children: [
          {
            path: '',
            name: 'dstModList',
            component: 'games/dst/mod/index.vue',
            meta: {
              title: '模组管理',
              icon: 'ri:puzzle-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.dstMods,
            },
          },
          {
            path: ':workshopId/detail',
            name: 'dstModDetail',
            component: 'games/dst/mod/detail.vue',
            meta: {
              title: 'Mod 详情',
              icon: 'ri:puzzle-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              activeMenu: FRONTEND_ROUTE_PATHS.dstMods,
              menu: false,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '备份与恢复',
      icon: 'ri:archive-line',
    },
    children: [
      {
        path: '/ops',
        component: 'Layout',
        name: 'ops',
        redirect: FRONTEND_ROUTE_PATHS.opsBackups,
        meta: {
          title: '备份与恢复',
          icon: 'ri:archive-line',
          auth: OPS_READ_PERMISSION,
        },
        children: [
          {
            path: 'backups',
            name: 'opsBackups',
            component: 'ops/backups/index.vue',
            meta: {
              title: '备份与恢复',
              icon: 'ri:archive-line',
              auth: OPS_READ_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.opsBackups,
              keepAlive: true,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '计划任务',
      icon: 'ri:timer-line',
    },
    children: [
      {
        path: '/ops-schedule',
        component: 'Layout',
        name: 'opsSchedule',
        redirect: FRONTEND_ROUTE_PATHS.opsSchedules,
        meta: {
          title: '计划任务',
          icon: 'ri:timer-line',
          auth: OPS_READ_PERMISSION,
        },
        children: [
          {
            path: 'schedules',
            name: 'opsSchedules',
            component: 'ops/schedules/index.vue',
            meta: {
              title: '计划任务',
              icon: 'ri:timer-line',
              auth: OPS_READ_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: FRONTEND_ROUTE_PATHS.opsSchedules,
              keepAlive: true,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '系统设置',
      icon: 'ri:settings-3-line',
    },
    children: [
      {
        path: '/system',
        component: 'Layout',
        name: 'system',
        redirect: '/system/settings',
        meta: {
          title: '系统设置',
          icon: 'ri:settings-3-line',
          auth: SYSTEM_MANAGE_PERMISSION,
        },
        children: [
          {
            path: 'settings',
            name: 'systemSettings',
            component: 'system/settings.vue',
            meta: {
              title: '系统设置',
              icon: 'ri:settings-4-line',
              auth: SYSTEM_MANAGE_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: '/system',
            },
          },
          {
            path: 'notify',
            name: 'systemNotify',
            component: 'system/notify.vue',
            meta: {
              title: '通知渠道',
              icon: 'ri:notification-3-line',
              auth: SYSTEM_MANAGE_PERMISSION,
              menu: false,
              breadcrumb: false,
              activeMenu: '/system',
            },
          },
        ],
      },
    ],
  },
]
