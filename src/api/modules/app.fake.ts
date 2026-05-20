import { faker } from '@faker-js/faker'
import { defineFakeRoute } from 'vite-plugin-fake-server/client'

const routeList = [
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
          auth: 'pages.node.instance:manage',
        },
        children: [
          {
            path: 'instance',
            name: 'nodeInstance',
            component: 'node/instance/index.vue',
            meta: {
              title: '实例管理',
              icon: 'ri:stack-line',
              auth: 'pages.node.instance:manage',
            },
          },
          {
            path: 'instance/console/:instanceId',
            name: 'nodeInstanceConsole',
            component: 'node/instance/console.vue',
            meta: {
              title: '实例控制台',
              icon: 'ri:terminal-line',
              auth: 'pages.node.instance:manage',
              activeMenu: '/node/instance',
              menu: false,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '房间',
      icon: 'ri:home-wifi-line',
    },
    children: [
      {
        path: '/cluster',
        component: 'Layout',
        name: 'cluster',
        meta: {
          title: '房间管理',
          icon: 'ri:community-line',
          auth: 'pages.node.instance:manage',
        },
        children: [
          {
            path: 'list',
            name: 'clusterList',
            component: 'cluster/index.vue',
            meta: {
              title: '房间列表',
              icon: 'ri:list-check',
              auth: 'pages.node.instance:manage',
            },
          },
          {
            path: 'settings/:instanceId',
            name: 'clusterSettings',
            component: 'cluster/settings.vue',
            meta: {
              title: '房间设置',
              icon: 'ri:settings-3-line',
              auth: 'pages.node.instance:manage',
              activeMenu: '/cluster/list',
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

export default defineFakeRoute([
  {
    url: '/fake/app/route/list',
    method: 'get',
    response: () => {
      return {
        error: '',
        status: 1,
        data: routeList,
      }
    },
  },
  {
    url: '/fake/app/account/login',
    method: 'post',
    response: ({ body }) => {
      return {
        error: '',
        status: 1,
        data: {
          account: body.account,
          token: `${body.account}:${faker.internet.jwt()}`,
          avatar: `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${body.account}`,
          email: `${body.account}@game.com`,
          remember: body.remember === true,
          mustChangePassword: body.account === 'superman',
        },
      }
    },
  },
  {
    url: '/fake/app/account/logout',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/app/account/permission',
    method: 'get',
    response: ({ headers }) => {
      let permissions: string[] = []
      if (headers.token?.indexOf('admin') === 0) {
        permissions = [
          'pages.general:browse',
          'pages.form:browse',
          'pages.list:browse',
          'pages.shop:browse',
          'pages.node.instance:manage',
        ]
      }
      else if (headers.token?.indexOf('test') === 0) {
        permissions = [
          'pages.general:browse',
        ]
      }
      return {
        error: '',
        status: 1,
        data: {
          permissions,
          mustChangePassword: false,
        },
      }
    },
  },
  {
    url: '/fake/app/account/password/edit',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
          mustChangePassword: false,
        },
      }
    },
  },
])
