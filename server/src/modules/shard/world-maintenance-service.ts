import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { ShardId, ShardMaintenanceResult } from '../../../../shared/contracts/shard'
import type { DbBackupKind } from '../../shared/db/index'
import type { ResolvedLocalDstInstance } from '../../shared/dst/local-dst-instance'
import { DST_STORAGE_DIR } from '../../infra/game-adapter/dst/constants'
import {
  buildResetWorldCommand,
  buildRollbackCommand,
  listShardSnapshots,
  readMaxSnapshots,
  validateRollbackSteps,
  warnWhenStepsExceedSnapshots,
} from '../../infra/game-adapter/dst/world-maintenance'
import { createInstanceBackup } from '../backup/backup-service'
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

/**
 * 危险操作前的安全备份。
 *
 * 备份失败不阻断操作，但必须把失败如实带回界面：让用户在"没有安全备份"的前提下
 * 自己做决定，比默默失败或默默阻断都更诚实。
 */
async function createSafetyBackup(input: MaintenanceInput): Promise<{ backupId: string | null, warning: string | null }> {
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

  return runDangerousCommand({
    app: input.app,
    instance: input.instance,
    shard: input.shard,
    command: buildResetWorldCommand(),
    backupKind: 'pre_reset',
    backupNote: `重置世界前自动备份（${input.instance.name}）`,
    backupBefore: true,
  })
}
