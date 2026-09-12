import type { ShardListDto, ShardSavePayload } from '../../../shared/contracts/shard'
import { defineFakeRoute } from 'vite-plugin-fake-server/client'

const shardStore = new Map<string, ShardListDto>()

function defaultShardList(instanceId: string): ShardListDto {
  return {
    instanceId,
    instanceName: `实例 ${instanceId.slice(0, 8)}`,
    instanceStatus: 'stopped',
    clusterShardEnabled: false,
    shards: [
      {
        id: 'master',
        displayName: '主世界（地表）',
        configured: true,
        containerStatus: 'not_created',
        serverPort: 10999,
        steamAuthPort: 8766,
        steamMasterPort: 12346,
        worldgenPreset: 'SURVIVAL_TOGETHER',
        overrides: { day: 'default', krampus: 'default', world_size: 'default' },
        worldGenerated: false,
        isMaster: true,
        panelSaved: false,
        configDirty: false,
      },
      {
        id: 'caves',
        displayName: '洞穴（地下）',
        configured: false,
        containerStatus: 'not_created',
        serverPort: null,
        steamAuthPort: null,
        steamMasterPort: null,
        worldgenPreset: null,
        overrides: null,
        worldGenerated: false,
        isMaster: false,
        panelSaved: false,
        configDirty: false,
      },
    ],
    // 服务端恒为空数组（说明已内联到页面），fake 保持同形状
    effectiveHints: [],
    warnings: [],
  }
}

export default defineFakeRoute([
  {
    url: '/fake/app/instance/shards',
    method: 'get',
    response: ({ query }) => {
      const instanceId = typeof query.instanceId === 'string' ? query.instanceId : ''
      const data = shardStore.get(instanceId) ?? defaultShardList(instanceId)
      shardStore.set(instanceId, data)
      return { error: '', status: 1, data }
    },
  },
  {
    url: '/fake/app/instance/shards/init-caves',
    method: 'post',
    response: ({ query }) => {
      const instanceId = typeof query.instanceId === 'string' ? query.instanceId : ''
      const list = shardStore.get(instanceId) ?? defaultShardList(instanceId)
      const caves = list.shards.find(s => s.id === 'caves')!
      caves.configured = true
      caves.serverPort = 11000
      caves.steamAuthPort = 8768
      caves.steamMasterPort = 12348
      caves.worldgenPreset = 'DST_CAVE'
      shardStore.set(instanceId, list)
      return {
        error: '',
        status: 1,
        data: {
          initialized: true,
          alreadyConfigured: false,
          serverPort: 11000,
          steamAuthPort: 8768,
          steamMasterPort: 12348,
          worldgenPreset: 'DST_CAVE',
        },
      }
    },
  },
  {
    url: '/fake/app/instance/shards',
    method: 'put',
    response: ({ body }) => {
      const payload = body as ShardSavePayload
      const list = shardStore.get(payload.instanceId) ?? defaultShardList(payload.instanceId)
      const shard = list.shards.find(s => s.id === payload.shard)
      if (shard) {
        shard.serverPort = payload.serverPort
        shard.steamAuthPort = payload.steamAuthPort
        shard.steamMasterPort = payload.steamMasterPort
        shard.worldgenPreset = payload.worldgenPreset
        const merged = {
          ...shard.overrides,
          ...payload.worldRuleOverrides,
          ...payload.worldgenOverrides,
        }
        if (Object.keys(merged).length > 0) {
          shard.overrides = merged
        }
        if (payload.worldgenOverrides && !shard.worldGenerated) {
          shard.worldGenerated = false
        }
        shard.configured = true
        if (payload.shard === 'master') {
          shard.panelSaved = true
        }
      }
      shardStore.set(payload.instanceId, list)
      return { error: '', status: 1, data: { saved: true, restarted: Boolean(payload.restart) } }
    },
  },
])
