import type {
  PlayerKuId,
  PlayerListDto,
  PlayerListEntry,
  PlayerListKind,
  PlayerListSavePayload,
  PlayerListSaveResult,
} from '../../../shared/contracts/player'
import api from '../index'

export type {
  PlayerKuId,
  PlayerListDto,
  PlayerListEntry,
  PlayerListKind,
  PlayerListSavePayload,
  PlayerListSaveResult,
}

export default {
  getPlayerList: (instanceId: string, kind: PlayerListKind) => api.get('app/instance/players', {
    params: { instanceId, kind },
  }) as Promise<{ data: PlayerListDto }>,
  savePlayerList: (payload: PlayerListSavePayload) => api.put('app/instance/players', payload) as Promise<{ data: PlayerListSaveResult }>,
}
