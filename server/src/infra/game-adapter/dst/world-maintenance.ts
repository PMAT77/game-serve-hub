import fs from 'node:fs'
import path from 'node:path'
import type { ShardId } from '../../../../../shared/contracts/shard'
import { SHARD_ROLLBACK_STEPS_LIMIT } from '../../../../../shared/contracts/shard'
import { parseClusterIni } from './cluster-ini'
import { resolveClusterPaths } from './cluster-service'
import { resolveShardSaveDir } from './shard-layout'

export interface DstShardSnapshot {
  /** 存档点目录名（游戏生成的会话 ID），只在界面用于区分，不由面板解释其含义 */
  id: string
  /** 目录的最后修改时间（ISO）；读不到时为空串 */
  savedAt: string
}

/**
 * 列出分片的存档点目录。
 *
 * DST 把每个存档点放在 `<分片>/save/session/<会话 ID>/` 下。目录结构随游戏版本变化，
 * 因此这里只按修改时间倒序展示，读不到就返回空数组，界面退化为纯步数选择。
 */
export function listShardSnapshots(installPath: string, shardId: ShardId): DstShardSnapshot[] {
  const sessionDir = path.join(resolveShardSaveDir(installPath, shardId), 'session')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(sessionDir, { withFileTypes: true })
  }
  catch {
    return []
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map((entry) => {
      let savedAt = ''
      try {
        savedAt = fs.statSync(path.join(sessionDir, entry.name)).mtime.toISOString()
      }
      catch {
        savedAt = ''
      }
      return { id: entry.name, savedAt }
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** 房间配置里的快照保留数量（决定回档可用的天数上限） */
export function readMaxSnapshots(installPath: string): number {
  const { clusterIniPath } = resolveClusterPaths(installPath)
  if (!fs.existsSync(clusterIniPath)) {
    return 6
  }
  return parseClusterIni(fs.readFileSync(clusterIniPath, 'utf8')).fields.maxSnapshots
}

export function buildRollbackCommand(steps: number): string {
  return `c_rollback(${steps})`
}

export function buildResetWorldCommand(): string {
  return 'c_reset()'
}

export function validateRollbackSteps(steps: number, maxSnapshots: number): string[] {
  const errors: string[] = []
  if (!Number.isInteger(steps) || steps < 1) {
    errors.push('回档步数须为大于 0 的整数')
    return errors
  }
  if (steps > SHARD_ROLLBACK_STEPS_LIMIT) {
    errors.push(`回档步数不能超过 ${SHARD_ROLLBACK_STEPS_LIMIT}`)
    return errors
  }
  if (steps > maxSnapshots) {
    errors.push(`回档步数不能超过房间设置的快照保留数量（当前 ${maxSnapshots}）`)
  }
  return errors
}

/**
 * 步数超过实际存档点数量时的提示。
 *
 * 只作为提示而不是拒绝：存档点目录的读取结果受游戏版本影响，
 * 宁可由游戏自己报错，也不要因为面板读不到目录就挡下合法回档。
 */
export function warnWhenStepsExceedSnapshots(steps: number, snapshotCount: number): string | null {
  if (snapshotCount <= 0 || steps <= snapshotCount) {
    return null
  }
  return `当前只读到 ${snapshotCount} 个存档点，回档 ${steps} 步可能超出可用范围`
}
