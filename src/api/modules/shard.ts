import type {
  ShardInitCavesResult,
  ShardListDto,
  ShardSavePayload,
  ShardSaveResult,
} from '../../../shared/contracts/shard'
import api from '../index'

export type {
  ShardId,
  ShardContainerStatus,
  ShardListDto,
  ShardSavePayload,
  ShardSaveResult,
  ShardSummaryDto,
  ShardInitCavesResult,
  CavesWorldgenPreset,
  MasterWorldgenPreset,
} from '../../../shared/contracts/shard'

export default {
  getShardList: (instanceId: string) => api.get('app/instance/shards', {
    params: { instanceId },
  }) as Promise<{ data: ShardListDto }>,
  initCaves: (instanceId: string) => api.post('app/instance/shards/init-caves', undefined, {
    params: { instanceId },
  }) as Promise<{ data: ShardInitCavesResult }>,
  saveShardConfig: (payload: ShardSavePayload) => api.put('app/instance/shards', payload) as Promise<{ data: ShardSaveResult }>,
}
