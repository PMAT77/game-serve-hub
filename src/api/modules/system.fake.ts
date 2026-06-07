import { defineFakeRoute } from 'vite-plugin-fake-server/client'

let panelSettings = {
  panelPort: 80,
  theme: 'system' as const,
  autoUpdate: true,
  checkUpdateBeforeStart: false,
  updateCheckIntervalHours: 3,
}

const panelUpdateStatus = {
  panel: {
    image: 'ghcr.io/gameserverhub/game-server-hub:latest',
    tag: 'latest',
    releaseVersion: '0.1.0',
    localDigest: 'sha256:abc123',
    localDigestShort: 'abc123',
    remoteDigest: 'sha256:def456',
    remoteDigestShort: 'def456',
    updateAvailable: true,
    localPresent: true,
    checkError: null,
  },
  dst: {
    image: 'ghcr.io/gameserverhub/game-server-hub-dst:latest',
    tag: 'latest',
    releaseVersion: '0.1.0',
    localDigest: 'sha256:abc123',
    localDigestShort: 'abc123',
    remoteDigest: 'sha256:abc123',
    remoteDigestShort: 'abc123',
    updateAvailable: false,
    localPresent: true,
    checkError: null,
  },
  release: {
    tagName: 'v0.2.0',
    name: 'v0.2.0',
    body: '- 面板更新检测\n- DST 运行镜像优化',
    publishedAt: new Date().toISOString(),
    htmlUrl: 'https://github.com/GameServerHub/game-server-hub/releases/tag/v0.2.0',
  },
  lastCheckedAt: new Date().toISOString(),
  checking: false,
  updating: false,
  applySupported: true,
  panelApplySupported: false,
  dstApplySupported: true,
  applyHint: '开发环境未配置 GSH_STACK_DIR',
  manualUpdateCommand: 'cd /opt/game-server-hub && docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml pull && docker pull ghcr.io/gameserverhub/game-server-hub-dst:latest && docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d',
  checkError: null,
}

let networkTick = 0

export default defineFakeRoute([
  {
    url: '/fake/app/system/settings',
    method: 'get',
    response: () => ({
      error: '',
      status: 1,
      data: {
        ...panelSettings,
        apiPort: 9527,
      },
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
        checkUpdateBeforeStart: Boolean(body.checkUpdateBeforeStart),
        updateCheckIntervalHours: Number(body.updateCheckIntervalHours) || 3,
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
          usageRate: 23.5,
        },
        load: {
          oneMinute: 1.2,
          fiveMinutes: 0.9,
          fifteenMinutes: 0.7,
          usageRate: 15,
          isSynthetic: false,
          cpuQueueLength: null,
          diskQueueLength: null,
        },
        memory: {
          totalGb: 16,
          usedGb: 6.2,
          freeGb: 9.8,
          usageRate: 38.75,
          availableGb: 9.5,
        },
        memoryGuidance: {
          tier: 'large',
          tierLabelZh: '充足（8 GiB 及以上）',
          presetName: 'large',
          totalMb: 16384,
          availableMb: 9728,
          summaryZh: '总内存较充足：适合洞穴与较多 Mod；仍建议为 SteamCMD 安装预留空闲内存。',
          scenarios: {
            singleInstance: '单实例 + 洞穴 + 较多 Mod 较从容',
            caves: '洞穴与地上可同时运行',
            mods: '较多 Mod 仍建议观察 DST 容器内存',
            multiInstance: '同机多实例需自行规划总内存与上限',
          },
          cavesWarning: null,
          modsWarning: null,
          installWarning: null,
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
  {
    url: '/fake/app/system/network/realtime',
    method: 'get',
    response: () => {
      networkTick += 1
      const wave = Math.sin(networkTick / 3)
      return {
        error: '',
        status: 1,
        data: {
          timestamp: Date.now(),
          interfaces: [
            {
              name: 'eth0',
              upBps: Number((120_000 + wave * 40_000).toFixed(2)),
              downBps: Number((860_000 + wave * 120_000).toFixed(2)),
              totalSentBytes: 1_024_000_000 + networkTick * 50_000,
              totalReceivedBytes: 8_192_000_000 + networkTick * 200_000,
            },
            {
              name: 'docker0',
              upBps: Number((12_000 + wave * 5_000).toFixed(2)),
              downBps: Number((45_000 + wave * 8_000).toFixed(2)),
              totalSentBytes: 256_000_000 + networkTick * 10_000,
              totalReceivedBytes: 512_000_000 + networkTick * 20_000,
            },
          ],
        },
      }
    },
  },
  {
    url: '/fake/app/system/panel-update/status',
    method: 'get',
    response: () => ({
      error: '',
      status: 1,
      data: panelUpdateStatus,
    }),
  },
  {
    url: '/fake/app/system/panel-update/check',
    method: 'post',
    response: () => ({
      error: '',
      status: 1,
      data: {
        ...panelUpdateStatus,
        lastCheckedAt: new Date().toISOString(),
      },
    }),
  },
  {
    url: '/fake/app/system/panel-update/apply',
    method: 'post',
    response: () => ({
      error: '',
      status: 1,
      data: {
        status: 'completed',
        message: 'DST 运行镜像已更新，下次启动实例时将使用新环境。',
        applied: ['dst'],
      },
    }),
  },
])
