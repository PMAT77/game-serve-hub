import type { PlayerOnlineEntry, PlayerOnlineRosterDto, PlayerShard } from '../../../../../shared/contracts/player'
import type { DstConsoleShard } from '../../../shared/instance/dst-container-command-port'
import type { DstOnlinePlayer } from './online-players'

/** 本次查询涉及哪些分片、各自是否在运行 */
export interface PlayerRosterShardPlan {
  shard: DstConsoleShard
  configured: boolean
  running: boolean
}

/** 某个分片的查询结果；players 为 null 表示这次没查到（「不知道」） */
export interface PlayerRosterSnapshot {
  shard: DstConsoleShard
  players: DstOnlinePlayer[] | null
}

/** 把各分片结果摊平成一份带世界标记的在线名单 */
export function flattenShardPlayers(snapshots: PlayerRosterSnapshot[]): PlayerOnlineEntry[] {
  const players: PlayerOnlineEntry[] = []
  for (const snapshot of snapshots) {
    for (const player of snapshot.players ?? []) {
      players.push({ kuId: player.kuId, name: player.name, shard: snapshot.shard })
    }
  }
  return players
}

/**
 * 汇总成给界面的在线玩家总览。
 *
 * 三件事必须分清，否则界面会给出错误结论：
 * - `running`：房间整体是否在运行；
 * - `partial`：有没有「运行着却查不到」的分片——此时名单可能不全，界面要提示而不是当成没人在线；
 * - `onlinePlayerCount`：没查到的分片不计入，全部没查到时为 null（「不知道」而非 0）。
 */
export function buildPlayerRoster(input: {
  instanceId: string
  plans: PlayerRosterShardPlan[]
  snapshots: PlayerRosterSnapshot[]
  maxPlayers: number
}): PlayerOnlineRosterDto {
  const { instanceId, plans, snapshots, maxPlayers } = input
  const snapshotOf = (shard: PlayerShard) => snapshots.find(item => item.shard === shard)
  const planOf = (shard: PlayerShard) => plans.find(item => item.shard === shard)
  const entriesOf = (shard: PlayerShard): PlayerOnlineEntry[] | null => {
    const list = snapshotOf(shard)?.players
    return list ? list.map(player => ({ kuId: player.kuId, name: player.name, shard })) : null
  }
  const runningShards = plans.filter(plan => plan.running)
  const answered = runningShards
    .map(plan => snapshotOf(plan.shard)?.players ?? null)
    .filter((list): list is DstOnlinePlayer[] => list !== null)

  return {
    instanceId,
    running: runningShards.length > 0,
    maxPlayers,
    onlinePlayerCount: answered.length > 0 ? answered.reduce((sum, list) => sum + list.length, 0) : null,
    shards: {
      master: {
        running: planOf('master')?.running ?? false,
        configured: true,
        players: entriesOf('master'),
      },
      caves: {
        running: planOf('caves')?.running ?? false,
        configured: planOf('caves')?.configured ?? false,
        players: entriesOf('caves'),
      },
    },
    players: flattenShardPlayers(snapshots),
    partial: runningShards.some(plan => (snapshotOf(plan.shard)?.players ?? null) === null),
  }
}
