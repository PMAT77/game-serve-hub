import type {
  ShardId,
  ShardInitCavesResult,
  ShardListDto,
  ShardMaintenanceResult,
  ShardRollbackPayload,
  ShardSavePayload,
  ShardSaveResult,
  ShardSnapshotsDto,
} from '../../../shared/contracts/shard'
import api from '../index'

export type {
  ShardId,
  ShardContainerStatus,
  ShardListDto,
  ShardMaintenanceResult,
  ShardRollbackPayload,
  ShardSavePayload,
  ShardSaveResult,
  ShardSnapshotDto,
  ShardSnapshotsDto,
  ShardSummaryDto,
  ShardInitCavesResult,
  CavesWorldgenPreset,
  MasterWorldgenPreset,
} from '../../../shared/contracts/shard'

export { shardSavePayloadSchema } from '../../../shared/contracts/shard'

export default {
  getShardList: (instanceId: string) => api.get('app/instance/shards', {
    params: { instanceId },
  }) as Promise<{ data: ShardListDto }>,
  initCaves: (instanceId: string) => api.post('app/instance/shards/init-caves', undefined, {
    params: { instanceId },
  }) as Promise<{ data: ShardInitCavesResult }>,
  saveShardConfig: (payload: ShardSavePayload) => api.put('app/instance/shards', payload) as Promise<{ data: ShardSaveResult }>,
  getShardSnapshots: (instanceId: string, shard: ShardId) => api.get('app/instance/shards/snapshots', {
    params: { instanceId, shard },
  }) as Promise<{ data: ShardSnapshotsDto }>,
  rollbackShard: (payload: ShardRollbackPayload) => api.post('app/instance/shards/rollback', payload) as Promise<{ data: ShardMaintenanceResult }>,
  resetShardWorld: (payload: { instanceId: string, shard: ShardId, confirmName: string }) => api.post('app/instance/shards/reset-world', payload) as Promise<{ data: ShardMaintenanceResult }>,
}
