import type {
  PlayerActionPayload,
  PlayerBanResult,
  PlayerKickPayload,
  PlayerKickResult,
  PlayerListDto,
  PlayerListKind,
  PlayerListSavePayload,
  PlayerListSaveResult,
  PlayerOnlineRosterDto,
  PlayerProfileNotePayload,
  PlayerProfileSearchResult,
  PlayerProfileSyncResult,
} from '../../../shared/contracts/player'
import api from '../index'

export type {
  PlayerActionPayload,
  PlayerBanResult,
  PlayerKickPayload,
  PlayerKickResult,
  PlayerKuId,
  PlayerListDto,
  PlayerListEntry,
  PlayerListKind,
  PlayerListSavePayload,
  PlayerListSaveResult,
  PlayerOnlineEntry,
  PlayerOnlineRosterDto,
  PlayerProfileDto,
  PlayerProfileNotePayload,
  PlayerProfileSearchResult,
  PlayerProfileSyncResult,
  PlayerShard,
} from '../../../shared/contracts/player'

export default {
  getPlayerList: (instanceId: string, kind: PlayerListKind) => api.get('app/instance/players', {
    params: { instanceId, kind },
  }) as Promise<{ data: PlayerListDto }>,
  savePlayerList: (payload: PlayerListSavePayload) => api.put('app/instance/players', payload) as Promise<{ data: PlayerListSaveResult }>,
  getOnlinePlayers: (instanceId: string) => api.get('app/instance/players/online', {
    params: { instanceId },
  }) as Promise<{ data: PlayerOnlineRosterDto }>,
  searchProfiles: (instanceId: string, keyword: string) => api.get('app/instance/players/profiles', {
    params: { instanceId, keyword },
  }) as Promise<{ data: PlayerProfileSearchResult }>,
  syncProfiles: (instanceId: string) => api.post('app/instance/players/profiles/sync', {
    instanceId,
  }) as Promise<{ data: PlayerProfileSyncResult }>,
  saveProfileNote: (payload: PlayerProfileNotePayload) => api.put('app/instance/players/profiles/note', payload) as Promise<{ data: PlayerProfileSearchResult }>,
  // 踢出比封禁宽松：非 Klei 账号的玩家（离线 / 局域网的路人）也要能清场
  kickPlayer: (payload: PlayerKickPayload) => api.post('app/instance/players/kick', payload) as Promise<{ data: PlayerKickResult }>,
  banPlayer: (payload: PlayerActionPayload) => api.post('app/instance/players/ban', payload) as Promise<{ data: PlayerBanResult }>,
}
