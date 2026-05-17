import { defineFakeRoute } from 'vite-plugin-fake-server/client'

let panelSettings = {
  panelPort: 80,
  theme: 'system' as const,
  autoUpdate: true,
}

export default defineFakeRoute([
  {
    url: '/fake/app/system/settings',
    method: 'get',
    response: () => ({
      error: '',
      status: 1,
      data: panelSettings,
    }),
  },
  {
    url: '/fake/app/system/settings',
    method: 'post',
    response: ({ body }) => {
      panelSettings = {
        panelPort: Number(body.panelPort) || 80,
        theme: body.theme ?? 'system',
        autoUpdate: Boolean(body.autoUpdate),
      }
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
    url: '/fake/app/system/info',
    method: 'get',
    response: () => ({
      error: '',
      status: 1,
      data: {
        cpu: {
          cores: 8,
          model: 'Mock CPU',
        },
        memory: {
          totalGb: 16,
          usedGb: 6.2,
          freeGb: 9.8,
          usageRate: 38.75,
        },
        disk: {
          totalGb: 512,
          usedGb: 212,
          freeGb: 300,
        },
        os: {
          platform: 'linux',
          release: '6.8.0',
          arch: 'x64',
          hostname: 'mock-host',
        },
        panelVersion: '0.1.0',
        dockerStatus: 'running',
      },
    }),
  },
])
