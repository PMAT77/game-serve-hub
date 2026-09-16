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
  /** 该分片上报的人数；players 为 null（没查到）时它也是 null */
  count: number | null
}

/** 把各分片结果摊平成一份带世界标记的在线名单 */
export function flattenShardPlayers(snapshots: PlayerRosterSnapshot[]): PlayerOnlineEntry[] {
  const players: PlayerOnlineEntry[] = []
  for (const snapshot of snapshots) {
    for (const player of snapshot.players ?? []) {
      players.push({
        kuId: player.kuId,
        name: player.name,
        shard: snapshot.shard,
        kleiAccount: player.kleiAccount,
        key: player.key,
      })
    }
  }
  return players
}

/** 某个分片上报的人数；明细用条数兜底（老调用方不带 count 时不至于算成 0） */
function playerCountOf(snapshot: PlayerRosterSnapshot): number {
  return snapshot.count ?? snapshot.players?.length ?? 0
}

/**
 * 该分片「有人却列不出来」的数量。
 *
 * 游戏没给出可用 ID 的玩家会被算进人数读数，却进不了明细；差额必须往上传，
 * 界面才能说明「另有 N 人无法列出」，而不是默默显示一张空列表。
 */
function unlistedCountOf(snapshot: PlayerRosterSnapshot): number {
  return Math.max(0, playerCountOf(snapshot) - (snapshot.players?.length ?? 0))
}

/**
 * 汇总成给界面的在线玩家总览。
 *
 * 四件事必须分清，否则界面会给出错误结论：
 * - `running`：房间整体是否在运行；
 * - `partial`：有没有「运行着却查不到」的分片——此时名单可能不全，界面要提示而不是当成没人在线；
 * - `onlinePlayerCount`：以游戏侧读数（count）为准，没查到的分片不计入，全部没查到时为
 *   null（「不知道」而非 0）。**不能改成明细条数**：没有可用 ID 的玩家会被漏掉，
 *   玩家管理页就会比实例详情页少算人（详情说 1 人、这里说没人）；
 * - `unlistedPlayerCount`：有人但列不出来的数量，界面据此说明原因。
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
    return list
      ? list.map(player => ({
          kuId: player.kuId,
          name: player.name,
          shard,
          kleiAccount: player.kleiAccount,
          key: player.key,
        }))
      : null
  }
  const countOf = (shard: PlayerShard): number | null => {
    const snapshot = snapshotOf(shard)
    return snapshot?.players == null ? null : playerCountOf(snapshot)
  }
  const unlistedOf = (shard: PlayerShard): number => {
    const snapshot = snapshotOf(shard)
    return snapshot?.players == null ? 0 : unlistedCountOf(snapshot)
  }

  const runningShards = plans.filter(plan => plan.running)
  const answered = runningShards
    .map(plan => snapshotOf(plan.shard))
    .filter((snapshot): snapshot is PlayerRosterSnapshot => (snapshot?.players ?? null) !== null)

  return {
    instanceId,
    running: runningShards.length > 0,
    maxPlayers,
    onlinePlayerCount: answered.length > 0
      ? answered.reduce((sum, snapshot) => sum + playerCountOf(snapshot), 0)
      : null,
    shards: {
      master: {
        running: planOf('master')?.running ?? false,
        configured: true,
        players: entriesOf('master'),
        count: countOf('master'),
        unlistedCount: unlistedOf('master'),
      },
      caves: {
        running: planOf('caves')?.running ?? false,
        configured: planOf('caves')?.configured ?? false,
        players: entriesOf('caves'),
        count: countOf('caves'),
        unlistedCount: unlistedOf('caves'),
      },
    },
    players: flattenShardPlayers(snapshots),
    unlistedPlayerCount: answered.reduce((sum, snapshot) => sum + unlistedCountOf(snapshot), 0),
    partial: runningShards.some(plan => (snapshotOf(plan.shard)?.players ?? null) === null),
  }
}
