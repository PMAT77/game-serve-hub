import { defineFakeRoute } from 'vite-plugin-fake-server/client'

type InstanceStatus = 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'

interface FakeInstanceItem {
  id: string
  nodeId: string
  name: string
  gameCode: string
  status: InstanceStatus
  containerId: string | null
  installPath: string | null
  configPath: string | null
  queryPort: number | null
  gamePort: number | null
  rconPort: number | null
  lastCommand: string | null
  lastError: string | null
  installLogStatus: 'running' | 'success' | 'failed' | null
  installPercent: number | null
  installLogUpdatedAt: string | null
  updateAvailable: boolean
  localBuildId: string | null
  remoteBuildId: string | null
  updateCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

const defaultInstallMeta = {
  installLogStatus: null,
  installPercent: null,
  installLogUpdatedAt: null,
} as const

const defaultUpdateMeta = {
  updateAvailable: false,
  localBuildId: null,
  remoteBuildId: null,
  updateCheckedAt: null,
} as const

interface InstallableGameItem {
  appId: string
  name: string
}

const nowIso = () => new Date().toISOString()
const generateId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
const installableGames: InstallableGameItem[] = [
  {
    appId: '343050',
    name: '饥荒联机（Dedicated Server）',
  },
]

let instanceList: FakeInstanceItem[] = []

function matchStatus(value: unknown): value is InstanceStatus {
  return value === 'running' || value === 'stopped' || value === 'installing' || value === 'error'
}

export default defineFakeRoute([
  {
    url: '/fake/app/instance/games',
    method: 'get',
    response: () => {
      return {
        error: '',
        status: 1,
        data: installableGames,
      }
    },
  },
  {
    url: '/fake/app/instance/install-log',
    method: 'get',
    response: ({ query }) => {
      const id = typeof query.id === 'string' ? query.id : ''
      const target = instanceList.find(item => item.id === id)
      const summary = [target?.lastCommand, target?.lastError].filter(Boolean).join('\n').trim()
      const persistedLog = target?.installLogStatus === 'success'
        ? 'SteamCMD 安装完成（fake 持久化日志示例）\nUpdate state (0x61) downloading, progress: 100.00'
        : null
      if (persistedLog) {
        return {
          error: '',
          status: 1,
          data: {
            content: persistedLog,
            status: target?.installLogStatus ?? 'unknown',
            updatedAt: target?.installLogUpdatedAt ?? target?.updatedAt ?? null,
            source: 'install_log' as const,
          },
        }
      }
      const source = summary ? 'status_summary' as const : 'empty' as const
      const content = summary
        ? ['【最近状态摘要，非完整 SteamCMD 输出】', '', summary].join('\n')
        : '暂无 SteamCMD 安装输出。'
      return {
        error: '',
        status: 1,
        data: {
          content,
          status: target?.status === 'error' ? 'failed' : target?.status === 'installing' ? 'running' : 'unknown',
          updatedAt: target?.updatedAt ?? null,
          source,
        },
      }
    },
  },
  {
    url: '/fake/app/instance/list',
    method: 'post',
    response: ({ body }) => {
      const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : ''
      const status = typeof body.status === 'string' && matchStatus(body.status)
        ? body.status
        : ''
      const keyword = typeof body.keyword === 'string' ? body.keyword.trim().toLowerCase() : ''
      const data = instanceList.filter((item) => {
        if (nodeId && item.nodeId !== nodeId) {
          return false
        }
        if (status && item.status !== status) {
          return false
        }
        if (!keyword) {
          return true
        }
        return item.name.toLowerCase().includes(keyword) || item.gameCode.toLowerCase().includes(keyword)
      })
      return {
        error: '',
        status: 1,
        data,
      }
    },
  },
  {
    url: '/fake/app/instance/create',
    method: 'post',
    response: ({ body }) => {
      const createdAt = nowIso()
      const item: FakeInstanceItem = {
        id: generateId(),
        nodeId: body.nodeId,
        name: body.name,
        gameCode: body.gameCode,
        status: 'stopped',
        containerId: null,
        installPath: body.installPath ?? null,
        configPath: body.configPath ?? null,
        queryPort: Number.isInteger(body.queryPort) ? body.queryPort : null,
        gamePort: Number.isInteger(body.gamePort) ? body.gamePort : null,
        rconPort: Number.isInteger(body.rconPort) ? body.rconPort : null,
        lastCommand: '等待安装任务启动',
        lastError: null,
        ...defaultInstallMeta,
        ...defaultUpdateMeta,
        createdAt,
        updatedAt: createdAt,
      }
      instanceList = [...instanceList, item]
      return {
        error: '',
        status: 1,
        data: item,
      }
    },
  },
  {
    url: '/fake/app/instance/check-updates',
    method: 'post',
    response: () => {
      const items = instanceList
        .filter(item => item.status === 'stopped' || item.status === 'running')
        .map(item => ({
          id: item.id,
          name: item.name,
          updateAvailable: item.id.endsWith('1'),
          localBuildId: '100',
          remoteBuildId: item.id.endsWith('1') ? '101' : '100',
          updateCheckedAt: nowIso(),
        }))
      instanceList = instanceList.map((item) => {
        const hit = items.find(row => row.id === item.id)
        if (!hit) {
          return item
        }
        return {
          ...item,
          updateAvailable: hit.updateAvailable,
          localBuildId: hit.localBuildId,
          remoteBuildId: hit.remoteBuildId,
          updateCheckedAt: hit.updateCheckedAt,
          updatedAt: nowIso(),
        }
      })
      return {
        error: '',
        status: 1,
        data: {
          items,
          updateAvailableCount: items.filter(item => item.updateAvailable).length,
        },
      }
    },
  },
  {
    url: '/fake/app/instance/update',
    method: 'post',
    response: ({ body }) => {
      const id = body.id as string
      const updatedAt = nowIso()
      instanceList = instanceList.map((item) => {
        if (item.id !== id) {
          return item
        }
        return {
          ...item,
          status: 'installing',
          lastCommand: '正在准备更新服务端...',
          lastError: null,
          installLogStatus: 'running',
          installPercent: 12,
          installLogUpdatedAt: updatedAt,
          updatedAt,
        }
      })
      setTimeout(() => {
        instanceList = instanceList.map((item) => {
          if (item.id !== id) {
            return item
          }
          return {
            ...item,
            status: 'stopped',
            lastCommand: '更新完成（fake）',
            lastError: null,
            installLogStatus: 'success',
            installPercent: 100,
            installLogUpdatedAt: nowIso(),
            updatedAt: nowIso(),
          }
        })
      }, 2500)
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
    url: '/fake/app/instance/start',
    method: 'post',
    response: ({ body }) => {
      const id = body.id as string
      instanceList = instanceList.map(item => item.id === id ? { ...item, status: 'running', updatedAt: nowIso() } : item)
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
    url: '/fake/app/instance/stop',
    method: 'post',
    response: ({ body }) => {
      const id = body.id as string
      instanceList = instanceList.map(item => item.id === id ? { ...item, status: 'stopped', updatedAt: nowIso() } : item)
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
    url: '/fake/app/instance/restart',
    method: 'post',
    response: ({ body }) => {
      const id = body.id as string
      instanceList = instanceList.map(item => item.id === id ? { ...item, status: 'running', updatedAt: nowIso() } : item)
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
    url: '/fake/app/instance/delete',
    method: 'post',
    response: ({ body }) => {
      const id = body.id as string
      instanceList = instanceList.filter(item => item.id !== id)
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
    url: '/fake/app/instance/console/logs',
    method: 'get',
    response: ({ query }) => {
      const instanceId = typeof query.instanceId === 'string' ? query.instanceId : ''
      const target = instanceList.find(item => item.id === instanceId)
      return {
        error: '',
        status: 1,
        data: {
          lines: target
            ? [{
                id: 1,
                stream: 'system',
                text: `[fake] 实例「${target.name}」控制台已连接`,
                at: nowIso(),
              }]
            : [],
          running: target?.status === 'running',
        },
      }
    },
  },
  {
    url: '/fake/app/instance/console/logs/clear',
    method: 'post',
    response: () => ({
      error: '',
      status: 1,
      data: { isSuccess: true },
    }),
  },
  {
    url: '/fake/app/instance/console/command',
    method: 'post',
    response: ({ body }) => {
      const instanceId = body.instanceId as string
      const command = String(body.command ?? '').trim()
      const target = instanceList.find(item => item.id === instanceId)
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: Boolean(target && command),
        },
      }
    },
  },
])
