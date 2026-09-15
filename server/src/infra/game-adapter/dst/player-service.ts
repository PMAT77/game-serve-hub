import fs from 'node:fs'
import type {
  PlayerListDto,
  PlayerListEntry,
  PlayerListKind,
  PlayerListSaveResult,
} from '../../../../../shared/contracts/player'
import { parseClusterIni } from './cluster-ini'
import { resolveClusterPaths } from './cluster-service'
import { readPlayerList, savePlayerList } from './player-lists'

/** 只需要实例 ID 与已解析的安装目录；调用方通常来自 resolveLocalDstInstance */
export interface PlayerListTarget {
  id: string
  installPath: string
}

function readWhitelistSlots(installPath: string): number {
  const { clusterIniPath } = resolveClusterPaths(installPath)
  if (!fs.existsSync(clusterIniPath)) {
    return 0
  }
  return parseClusterIni(fs.readFileSync(clusterIniPath, 'utf8')).fields.whitelistSlots
}

export function getPlayerList(target: PlayerListTarget, kind: PlayerListKind): PlayerListDto {
  const { clusterRoot } = resolveClusterPaths(target.installPath)
  const { entries, fileExists, warnings } = readPlayerList(clusterRoot, kind)
  return {
    instanceId: target.id,
    kind,
    entries,
    fileExists,
    whitelistSlots: readWhitelistSlots(target.installPath),
    warnings,
  }
}

export function savePlayerListForInstance(
  target: PlayerListTarget,
  kind: PlayerListKind,
  entries: PlayerListEntry[],
): PlayerListSaveResult {
  const { clusterRoot } = resolveClusterPaths(target.installPath)
  const saved = savePlayerList(clusterRoot, kind, entries)
  return {
    saved: true,
    entries: saved,
  }
}
