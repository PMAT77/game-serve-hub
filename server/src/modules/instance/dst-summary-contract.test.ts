import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dstInstanceSummariesSchema } from '../../../../shared/contracts/dst-summary'

const instance = {
  id: 'instance-1',
  nodeId: 'local-node',
  name: 'DST Server',
  gameCode: '343050',
  status: 'running',
  containerId: null,
  installPath: 'D:/games/dst',
  configPath: null,
  queryPort: null,
  gamePort: 10999,
  rconPort: null,
  lastCommand: null,
  lastError: null,
  unexpectedExitAt: null,
  installLogStatus: null,
  installPercent: null,
  installLogUpdatedAt: null,
  updateAvailable: false,
  localBuildId: null,
  remoteBuildId: null,
  updateCheckedAt: null,
  runtimeStartedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('DST summary API contracts', () => {
  it('accepts a complete room and world summary', () => {
    const result = dstInstanceSummariesSchema.parse({
      collectedAt: '2026-01-01T00:00:00.000Z',
      items: [{
        instance,
        room: {
          clusterName: 'My Room',
          networkMode: 'public',
          shardEnabled: true,
          onlinePlayerCount: 2,
          maxPlayers: 6,
          error: null,
        },
        world: {
          clusterShardEnabled: true,
          master: { configured: true, containerStatus: 'running' },
          caves: { configured: true, containerStatus: 'running' },
          error: null,
        },
      }],
    })
    assert.equal(result.items[0]?.room.onlinePlayerCount, 2)
    assert.equal(result.items[0]?.world.caves?.containerStatus, 'running')
  })

  it('accepts an unavailable instance as a row-level error', () => {
    assert.equal(dstInstanceSummariesSchema.safeParse({
      collectedAt: '2026-01-01T00:00:00.000Z',
      items: [{
        instance: { ...instance, status: 'pending_install' },
        room: {
          clusterName: null,
          networkMode: null,
          shardEnabled: null,
          onlinePlayerCount: null,
          maxPlayers: null,
          error: '实例尚未完成安装',
        },
        world: {
          clusterShardEnabled: null,
          master: null,
          caves: null,
          error: '实例尚未完成安装',
        },
      }],
    }).success, true)
  })
})
