import type { ShardId } from '@/api/modules/shard'
import { getWorldRuleOptionsForShard } from '../constants/dstWorldAssets'
import {
  buildWorldConfigRows,
  resolveRowLevelProfile,
  type DstWorldConfigTab,
} from '../constants/dstWorldRuleCatalog'
import { normalizeLevelValue } from '../constants/dstWorldRuleLevels'

function catalogOverrideKeys(shard: ShardId, tab: DstWorldConfigTab): Set<string> {
  const rows = buildWorldConfigRows(shard, tab, getWorldRuleOptionsForShard(shard))
  return new Set(rows.filter(r => !r.readOnly).map(r => r.overrideKey))
}

export function buildLeveldataOverridesPayload(
  shard: ShardId,
  tab: DstWorldConfigTab,
  local: Record<string, string>,
): Record<string, string> {
  const rows = buildWorldConfigRows(shard, tab, getWorldRuleOptionsForShard(shard))
  const result: Record<string, string> = {}
  for (const row of rows) {
    if (row.readOnly) {
      continue
    }
    const profile = resolveRowLevelProfile(row)
    result[row.overrideKey] = normalizeLevelValue(profile.levels, local[row.overrideKey])
  }
  return result
}

export function applyLeveldataOverridesFromServer(
  target: Record<string, string>,
  tab: DstWorldConfigTab,
  shard: ShardId,
  all: Record<string, string> | null | undefined,
) {
  for (const key of Object.keys(target)) {
    delete target[key]
  }
  if (!all) {
    return
  }
  const keys = catalogOverrideKeys(shard, tab)
  for (const [key, value] of Object.entries(all)) {
    if (keys.has(key)) {
      target[key] = value
    }
  }
}

/** @deprecated 使用 buildLeveldataOverridesPayload(shard, 'rules', local) */
export const buildWorldRuleOverridesPayload = (
  shard: ShardId,
  local: Record<string, string>,
) => buildLeveldataOverridesPayload(shard, 'rules', local)

/** @deprecated 使用 applyLeveldataOverridesFromServer */
export const applyWorldRuleOverridesFromServer = (
  target: Record<string, string>,
  overrides: Record<string, string> | null | undefined,
) => {
  for (const key of Object.keys(target)) {
    delete target[key]
  }
  if (!overrides) {
    return
  }
  for (const [key, value] of Object.entries(overrides)) {
    target[key] = value
  }
}
