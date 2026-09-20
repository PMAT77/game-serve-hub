import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ShardId, ShardMaintenanceResult, ShardResetWorldWithSeedResult } from '../../../../shared/contracts/shard'
import type { DbBackupKind } from '../../shared/db/index'
import type { ResolvedLocalDstInstance } from '../../shared/dst/local-dst-instance'
import { DST_STORAGE_DIR } from '../../infra/game-adapter/dst/constants'
import { markObservedWorldSeedStale, writeWorldSeed } from '../../infra/game-adapter/dst/panel-config-meta'
import { isCavesShardConfigured, removeShardSaveDir } from '../../infra/game-adapter/dst/shard-layout'
import { validateWorldSeed } from '../../infra/game-adapter/dst/world-seed'
import {
  buildResetWorldCommand,
  buildRollbackCommand,
  listShardSnapshots,
  readMaxSnapshots,
  validateRollbackSteps,
  warnWhenStepsExceedSnapshots,
} from '../../infra/game-adapter/dst/world-maintenance'
import { createInstanceBackup } from '../backup/backup-service'
import { injectRestartInstance } from '../instance/inject-restart'
import { syncInstanceModFilesFromDb } from '../mod/mod-file-sync-service'
import {
  ensureContainerRuntimeReady,
  isInstanceContainerRunning,
  sendInstanceContainerCommand,
} from '../instance/container-lifecycle'

export type ShardMaintenanceOutcome =
  | { ok: true, result: ShardMaintenanceResult, warnings: string[] }
  | { ok: false, message: string }

interface MaintenanceInput {
  app: FastifyInstance
  instance: ResolvedLocalDstInstance
  shard: ShardId
  command: string
  backupKind: DbBackupKind
  backupNote: string
  backupBefore: boolean
}

/** 备份所需的输入：runDangerousCommand 的入参是它的超集 */
interface SafetyBackupInput {
  app: FastifyInstance
  instance: ResolvedLocalDstInstance
  backupKind: DbBackupKind
  backupNote: string
  backupBefore: boolean
}

/**
 * 危险操作前的安全备份。
 *
 * 备份失败不阻断操作，但必须把失败如实带回界面：让用户在"没有安全备份"的前提下
 * 自己做决定，比默默失败或默默阻断都更诚实。
 */
async function createSafetyBackup(input: SafetyBackupInput): Promise<{ backupId: string | null, warning: string | null }> {
  if (!input.backupBefore) {
    return { backupId: null, warning: null }
  }
  const storageRoot = path.join(input.instance.installPath, DST_STORAGE_DIR)
  if (!fs.existsSync(storageRoot)) {
    return { backupId: null, warning: null }
  }
  const backupResult = await createInstanceBackup({
    app: input.app,
    instanceId: input.instance.id,
    kind: input.backupKind,
    note: input.backupNote,
    saveBeforeArchive: true,
  })
  if (backupResult.ok) {
    return { backupId: backupResult.backup?.id ?? null, warning: null }
  }
  return { backupId: null, warning: `安全备份未成功：${backupResult.message ?? '未知原因'}` }
}

async function runDangerousCommand(input: MaintenanceInput): Promise<ShardMaintenanceOutcome> {
  if (input.instance.status !== 'running') {
    return { ok: false, message: '实例未运行，无法执行世界维护操作' }
  }
  const runtimeReady = await ensureContainerRuntimeReady()
  if (!runtimeReady.ok) {
    return { ok: false, message: runtimeReady.message ?? '容器运行时未就绪' }
  }
  const running = await isInstanceContainerRunning(input.instance.id)
  if (!running) {
    return { ok: false, message: '实例容器未运行，无法执行世界维护操作' }
  }

  const backup = await createSafetyBackup(input)
  const sendResult = await sendInstanceContainerCommand(input.instance.id, input.command, input.shard)
  if (!sendResult.ok) {
    return { ok: false, message: sendResult.message ?? '命令发送失败' }
  }
  return {
    ok: true,
    warnings: backup.warning ? [backup.warning] : [],
    result: {
      accepted: true,
      command: input.command,
      backupId: backup.backupId,
      backupWarning: backup.warning,
    },
  }
}

export async function rollbackShard(input: {
  app: FastifyInstance
  instance: ResolvedLocalDstInstance
  shard: ShardId
  steps: number
  backupBeforeRollback?: boolean
}): Promise<ShardMaintenanceOutcome> {
  const maxSnapshots = readMaxSnapshots(input.instance.installPath)
  const errors = validateRollbackSteps(input.steps, maxSnapshots)
  if (errors.length > 0) {
    return { ok: false, message: errors.join('；') }
  }

  const outcome = await runDangerousCommand({
    app: input.app,
    instance: input.instance,
    shard: input.shard,
    command: buildRollbackCommand(input.steps),
    backupKind: 'pre_rollback',
    backupNote: `回档前自动备份（${input.instance.name}，回档 ${input.steps} 步）`,
    backupBefore: input.backupBeforeRollback !== false,
  })
  if (!outcome.ok) {
    return outcome
  }

  const warning = warnWhenStepsExceedSnapshots(
    input.steps,
    listShardSnapshots(input.instance.installPath, input.shard).length,
  )
  return {
    ok: true,
    result: outcome.result,
    warnings: warning ? [...outcome.warnings, warning] : outcome.warnings,
  }
}

export async function resetShardWorld(input: {
  app: FastifyInstance
  instance: ResolvedLocalDstInstance
  shard: ShardId
  confirmName: string
}): Promise<ShardMaintenanceOutcome> {
  if (input.confirmName.trim() !== input.instance.name.trim()) {
    return { ok: false, message: '二次确认失败：请输入完整的实例名称' }
  }

  const outcome = await runDangerousCommand({
    app: input.app,
    instance: input.instance,
    shard: input.shard,
    command: buildResetWorldCommand(),
    backupKind: 'pre_reset',
    backupNote: `重置世界前自动备份（${input.instance.name}）`,
    backupBefore: true,
  })
  if (outcome.ok) {
    // 世界会被重新生成，之前记下的种子不再代表这个世界：先作废，
    // 等读到新世界的会话标识再写回，期间界面显示「尚未读到」而不是旧种子。
    markObservedWorldSeedStale(input.instance.installPath, input.shard)
  }
  return outcome
}

export type ResetWorldWithSeedOutcome =
  | { ok: true, result: ShardResetWorldWithSeedResult, warnings: string[] }
  | { ok: false, message: string }

/**
 * 按填写的种子重置世界，并重新启动实例。
 *
 * 与「重置世界」（把 `c_reset()` 发给运行中的游戏进程）不同，这条路径要求实例**已停止**：
 * 面板先把种子记下来并落位到游戏目录，再删掉该分片的存档，最后启动实例——
 * 游戏启动时存档为空，于是按新的种子生成地图。
 */
export async function resetShardWorldWithSeed(input: {
  app: FastifyInstance
  request: FastifyRequest
  instance: ResolvedLocalDstInstance
  shard: ShardId
  worldSeed: string | null
}): Promise<ResetWorldWithSeedOutcome> {
  const { app, request, instance, shard, worldSeed } = input
  const installPath = instance.installPath

  let containerRunning = false
  try {
    containerRunning = await isInstanceContainerRunning(instance.id)
  }
  catch {
    // 探测不到就不能删存档：宁可拦住，也不能把运行中的世界文件删掉
    return { ok: false, message: '无法确认实例运行状态，请稍后重试' }
  }
  if (instance.status === 'running' || containerRunning) {
    return { ok: false, message: '请先停止实例：重置世界需要清掉当前存档' }
  }
  if (shard === 'caves' && !isCavesShardConfigured(installPath)) {
    return { ok: false, message: '洞穴尚未配置，无法重置洞穴世界' }
  }
  if (worldSeed !== null) {
    const seedError = validateWorldSeed(worldSeed)
    if (seedError) {
      return { ok: false, message: seedError }
    }
  }

  // 删存档不可逆，先备份；备份失败不阻断操作，但要如实带回界面
  const backup = await createSafetyBackup({
    app,
    instance,
    backupKind: 'pre_reset',
    backupNote: `重置世界前自动备份（${instance.name}）`,
    backupBefore: true,
  })

  try {
    writeWorldSeed(installPath, shard, worldSeed)
    await syncInstanceModFilesFromDb(instance.id, installPath)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `保存世界种子失败：${message}` }
  }
  // 世界即将重新生成，之前读到的种子不再代表这个世界
  markObservedWorldSeedStale(installPath, shard)

  try {
    removeShardSaveDir(installPath, shard)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `删除世界存档失败：${message}` }
  }

  // 启动实例：存档已为空，游戏会按刚落位的种子生成新地图
  const startError = await injectRestartInstance(app, request, instance.id)
  return {
    ok: true,
    warnings: backup.warning ? [backup.warning] : [],
    result: {
      accepted: true,
      backupId: backup.backupId,
      backupWarning: backup.warning,
      restarted: !startError,
      restartWarning: startError ? (startError.error || '启动实例失败，请手动启动') : null,
    },
  }
}
