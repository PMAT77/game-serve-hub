import fs from 'node:fs'
import type { DstInstanceSummariesDto, DstInstanceSummaryDto } from '../../../../shared/contracts/dst-summary'
import type { DbGameInstance } from '../../shared/db/index'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { getClusterConfig, resolveInstanceInstallPath } from '../../infra/game-adapter/dst/cluster-service'
import { queryDstOnlinePlayerCount } from '../../infra/game-adapter/dst/online-players'
import { getShardList } from '../../infra/game-adapter/dst/shard-service'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function unavailableSummary(instance: DbGameInstance, error: string): DstInstanceSummaryDto {
  return {
    instance,
    room: {
      clusterName: null,
      networkMode: null,
      shardEnabled: null,
      onlinePlayerCount: null,
      maxPlayers: null,
      error,
    },
    world: {
      clusterShardEnabled: null,
      master: null,
      caves: null,
      error,
    },
  }
}

async function buildSummary(instance: DbGameInstance): Promise<DstInstanceSummaryDto> {
  const installPath = resolveInstanceInstallPath(instance)
  if (instance.status === 'pending_install' || instance.status === 'installing' || !fs.existsSync(installPath)) {
    return unavailableSummary(instance, '实例尚未完成安装')
  }

  try {
    const [cluster, shardList] = await Promise.all([
      Promise.resolve(getClusterConfig(instance)),
      getShardList(instance),
    ])
    const onlinePlayerCount = instance.status === 'running'
      ? await queryDstOnlinePlayerCount(instance.id).catch(() => null)
      : null
    const master = shardList.shards.find(shard => shard.id === 'master')
    const caves = shardList.shards.find(shard => shard.id === 'caves')
    return {
      instance,
      room: {
        clusterName: cluster.clusterName,
        networkMode: cluster.networkMode,
        shardEnabled: cluster.shardEnabled,
        onlinePlayerCount,
        maxPlayers: cluster.maxPlayers,
        error: null,
      },
      world: {
        clusterShardEnabled: shardList.clusterShardEnabled,
        master: master
          ? { configured: master.configured, containerStatus: master.containerStatus }
          : null,
        caves: caves
          ? { configured: caves.configured, containerStatus: caves.containerStatus }
          : null,
        error: null,
      },
    }
  }
  catch (error) {
    return unavailableSummary(instance, getErrorMessage(error, '读取 DST 摘要失败'))
  }
}

export async function getDstInstanceSummaries(instances: DbGameInstance[]): Promise<DstInstanceSummariesDto> {
  const dstInstances = instances.filter(instance => instance.gameCode === DST_APP_ID)
  return {
    items: await Promise.all(dstInstances.map(buildSummary)),
    collectedAt: new Date().toISOString(),
  }
}
