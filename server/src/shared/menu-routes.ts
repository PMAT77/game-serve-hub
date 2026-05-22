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
  meta: MenuRouteMeta
  children?: MenuRouteItem[]
}

export const NODE_INSTANCE_MANAGE_PERMISSION = 'pages.node.instance:manage'

/**
 * 后端驱动的动态菜单与路由（component 为 views/ 下相对路径）。
 *
 * 组织约定：
 * - node/instance：跨游戏实例生命周期
 * - games/{gameCode}/：游戏域页面（DST cluster/shard 等）
 */
export const menuRouteList: MenuRouteItem[] = [
  {
    meta: {
      title: '控制台',
      icon: 'ri:dashboard-line',
    },
    children: [
      {
        path: '/console',
        component: 'Layout',
        name: 'console',
        meta: {
          title: '控制台',
          icon: 'ri:terminal-box-line',
        },
        children: [
          {
            path: 'monitor',
            name: 'consoleMonitor',
            component: 'console/monitor/index.vue',
            meta: {
              title: '监控台',
              icon: 'ri:pulse-line',
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '节点',
      icon: 'ri:server-line',
    },
    children: [
      {
        path: '/node',
        component: 'Layout',
        name: 'node',
        meta: {
          title: '节点管理',
          icon: 'ri:hard-drive-3-line',
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
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '游戏',
      icon: 'ri:gamepad-line',
    },
    children: [
      {
        path: '/games/dst',
        component: 'Layout',
        name: 'gamesDst',
        meta: {
          title: '饥荒',
          icon: 'ri:community-line',
          auth: NODE_INSTANCE_MANAGE_PERMISSION,
        },
        children: [
          {
            path: 'rooms',
            name: 'dstRoomList',
            component: 'games/dst/cluster/index.vue',
            meta: {
              title: '房间列表',
              icon: 'ri:list-check',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
            },
          },
          {
            path: 'rooms/:instanceId/settings',
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
          {
            path: 'worlds',
            name: 'dstWorldList',
            component: 'games/dst/shard/index.vue',
            meta: {
              title: '世界列表',
              icon: 'ri:earth-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
            },
          },
          {
            path: 'worlds/:instanceId/settings',
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
      title: '系统',
      icon: 'ri:settings-3-line',
    },
    children: [
      {
        path: '/system',
        component: 'Layout',
        name: 'system',
        meta: {
          title: '系统管理',
          icon: 'ri:computer-line',
        },
        children: [
          {
            path: 'settings',
            name: 'systemSettings',
            component: 'system/settings.vue',
            meta: {
              title: '系统设置',
              icon: 'ri:settings-4-line',
            },
          },
        ],
      },
    ],
  },
]
