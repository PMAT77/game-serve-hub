import type {
  ClusterConfigDto,
  ClusterGameMode,
  ClusterIntention,
  ClusterNetworkMode,
  ClusterOnlinePlayersDto,
  ClusterSavePayload,
  ClusterSaveResult,
} from '../../../shared/contracts/cluster'
import api from '../index'

export type {
  ClusterConfigDto,
  ClusterGameMode,
  ClusterIntention,
  ClusterNetworkMode,
  ClusterOnlinePlayersDto,
  ClusterSavePayload,
  ClusterSaveResult,
}

export default {
  getClusterConfig: (instanceId: string) => api.get('app/instance/cluster', {
    params: { instanceId },
  }) as Promise<{ data: ClusterConfigDto }>,
  getOnlinePlayers: (instanceId: string) => api.get('app/instance/cluster/online-players', {
    params: { instanceId },
  }) as Promise<{ data: ClusterOnlinePlayersDto }>,
  saveClusterConfig: (payload: ClusterSavePayload) => api.put('app/instance/cluster', payload) as Promise<{ data: ClusterSaveResult }>,
}
