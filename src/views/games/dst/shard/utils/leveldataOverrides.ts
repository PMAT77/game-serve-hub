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

/**
 * 构建世界规则覆盖提交负载。
 *
 * 传入 persisted（服务端当前已保存的 overrides 快照）时只提交与快照不同的项：
 * - 未被用户修改的项不再按目录默认值全量写入，避免改变游戏模板默认行为；
 * - 用户把已自定义项重置回默认值时，该键会显式下发，确保服务端合并后还原为默认。
 * 不传 persisted 时保持旧行为（全量提交），供历史调用兼容。
 */
export function buildLeveldataOverridesPayload(
  shard: ShardId,
  tab: DstWorldConfigTab,
  local: Record<string, string>,
  persisted?: Record<string, string> | null,
): Record<string, string> {
  const rows = buildWorldConfigRows(shard, tab, getWorldRuleOptionsForShard(shard))
  const result: Record<string, string> = {}
  for (const row of rows) {
    if (row.readOnly) {
      continue
    }
    const profile = resolveRowLevelProfile(row)
    const value = normalizeLevelValue(profile.levels, local[row.overrideKey])
    if (persisted != null && persisted[row.overrideKey] === value) {
      continue
    }
    result[row.overrideKey] = value
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
