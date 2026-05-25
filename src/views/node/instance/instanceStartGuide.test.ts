import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ClusterConfigDto } from '../../../../shared/contracts/cluster.ts'
import type { ShardListDto } from '../../../../shared/contracts/shard.ts'
import {
  buildInstanceStartGuideContext,
  buildStartGuideParagraphs,
  buildStartGuidePositiveText,
  INSTALL_DEFAULT_CLUSTER_DESCRIPTION,
  INSTALL_DEFAULT_MASTER_WORLDGEN_PRESET,
  isRoomSettingsCustomized,
  isWorldSettingsCustomized,
} from './instanceStartGuide.ts'

function baseCluster(overrides: Partial<ClusterConfigDto> = {}): ClusterConfigDto {
  return {
    instanceId: 'inst-1',
    instanceName: 'My DST',
    instanceStatus: 'stopped',
    networkMode: 'offline',
    clusterName: 'My DST',
    clusterDescription: INSTALL_DEFAULT_CLUSTER_DESCRIPTION,
    clusterPassword: '',
    gameMode: 'survival',
    maxPlayers: 6,
    pvp: false,
    pauseWhenEmpty: true,
    voteEnabled: true,
    clusterIntention: 'cooperative',
    tickRate: 15,
    maxSnapshots: 6,
    shardEnabled: false,
    bindIp: '127.0.0.1',
    masterIp: '127.0.0.1',
    masterPort: 10888,
    clusterKey: 'key',
    steamGroupOnly: false,
    steamGroupId: '0',
    steamGroupAdmins: false,
    clusterTokenConfigured: false,
    clusterTokenMasked: null,
    configDirty: false,
    effectiveHints: [],
    warnings: [],
    ...overrides,
  }
}

function baseShardList(overrides: Partial<ShardListDto> = {}): ShardListDto {
  return {
    instanceId: 'inst-1',
    instanceName: 'My DST',
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
        worldgenPreset: INSTALL_DEFAULT_MASTER_WORLDGEN_PRESET,
        leveldataOverrides: null,
        worldGenerated: false,
        isMaster: true,
        configDirty: false,
        warnings: [],
      },
    ],
    effectiveHints: [],
    warnings: [],
    ...overrides,
  }
}

describe('instanceStartGuide', () => {
  it('isWorldSettingsCustomized detects leveldata overrides', () => {
    const list = baseShardList({
      shards: [
        {
          ...baseShardList().shards[0]!,
          leveldataOverrides: { world_size: 'medium' },
        },
      ],
    })
    assert.equal(isWorldSettingsCustomized(list), true)
    assert.equal(isRoomSettingsCustomized(baseCluster()), false)
  })

  it('world-only customized uses current-config copy and button', () => {
    const cluster = baseCluster()
    const shardList = baseShardList({
      shards: [
        {
          ...baseShardList().shards[0]!,
          leveldataOverrides: { day: 'longer' },
        },
      ],
    })
    const ctx = buildInstanceStartGuideContext(
      { id: 'inst-1', name: 'My DST' },
      cluster,
      shardList,
    )
    assert.equal(ctx.worldCustomized, true)
    assert.equal(ctx.roomCustomized, false)
    assert.equal(buildStartGuidePositiveText(ctx), '按当前配置启动')
    const paragraphs = buildStartGuideParagraphs(ctx)
    assert.ok(paragraphs.some(p => p.includes('世界设置')))
    assert.ok(!paragraphs.some(p => p.includes('还没在面板里设置过「房间」和「地上世界」')))
  })

  it('neither customized offers default start button', () => {
    const ctx = buildInstanceStartGuideContext(
      { id: 'inst-1', name: 'My DST' },
      baseCluster(),
      baseShardList(),
    )
    assert.equal(buildStartGuidePositiveText(ctx), '用默认配置启动')
  })

  it('public without token blocks default start', () => {
    const ctx = buildInstanceStartGuideContext(
      { id: 'inst-1', name: 'My DST' },
      baseCluster({ networkMode: 'public' }),
      baseShardList(),
    )
    assert.equal(buildStartGuidePositiveText(ctx), '去配置房间')
  })
})
