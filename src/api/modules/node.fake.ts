import { defineFakeRoute } from 'vite-plugin-fake-server/client'

const now = () => new Date().toISOString()

let nodeList = [
  {
    id: 'local-node',
    name: '本地节点',
    host: 'mock-host',
    sshPort: 22,
    status: 'online' as const,
    resources: {
      cpu: {
        cores: 8,
        usageRate: 24.3,
        availableRate: 75.7,
      },
      memory: {
        totalGb: 16,
        usedGb: 6.1,
        freeGb: 9.9,
        usageRate: 38.13,
      },
      disk: {
        totalGb: 512,
        usedGb: 204,
        freeGb: 308,
        usageRate: 39.84,
      },
    },
    lastHeartbeatAt: now(),
    createdAt: now(),
    updatedAt: now(),
  },
]

export default defineFakeRoute([
  {
    url: '/fake/app/node/list',
    method: 'post',
    response: () => ({
      error: '',
      status: 1,
      data: nodeList,
    }),
  },
  {
    url: '/fake/app/node/local/register',
    method: 'post',
    response: () => {
      const current = nodeList[0]
      const next = {
        ...current,
        resources: {
          ...current.resources,
          cpu: {
            ...current.resources.cpu,
            usageRate: Number((15 + Math.random() * 35).toFixed(2)),
          },
        },
        lastHeartbeatAt: now(),
        updatedAt: now(),
      }
      next.resources.cpu.availableRate = Number((100 - next.resources.cpu.usageRate).toFixed(2))
      nodeList = [next]
      return {
        error: '',
        status: 1,
        data: next,
      }
    },
  },
])
