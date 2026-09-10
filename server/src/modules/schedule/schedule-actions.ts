import type { FastifyInstance } from 'fastify'
import { DB_BACKUP_INSTANCE_ID, createDatabaseSnapshot } from '../system/db-backup-routes'
import { createInstanceBackup } from '../backup/backup-service'
import { enqueueInstanceUpdateCheck, resolveSteamcmdCommandForUpdateCheck } from '../instance/update-check'
import { restartInstanceBySchedule } from '../instance/scheduled-entry'
import { emitPanelEvent } from '../notify/events'
import { getGameInstanceById } from '../../shared/db/index'
import type { DbScheduledTask, DbScheduleRunStatus } from '../../shared/db/index'

export interface ScheduleActionResult {
  status: DbScheduleRunStatus
  message: string
}

const SCHEDULED_OPERATOR = 'scheduler'

/** 需要具体实例的任务在执行前的互斥守卫：安装/更新中的实例一律跳过 */
function isInstanceBusy(status: string | undefined): boolean {
  return status === 'pending_install' || status === 'installing' || status === 'updating'
}

/**
 * 执行单个计划任务动作。调用方负责推进 next_run_at 与写回 last_run_*。
 * 返回 skipped 表示因互斥守卫/前置条件不满足而未执行（不算失败）。
 */
export async function executeScheduleAction(app: FastifyInstance, task: DbScheduledTask): Promise<ScheduleActionResult> {
  if (task.kind === 'db_snapshot') {
    const result = await createDatabaseSnapshot(app, SCHEDULED_OPERATOR)
    if (!result.ok) {
      return { status: 'failed', message: result.message ?? '数据库快照创建失败' }
    }
    return { status: 'ok', message: '数据库快照已创建' }
  }

  const instance = await getGameInstanceById(task.instanceId)
  if (!instance) {
    return { status: 'skipped', message: '实例不存在（可能已删除），请清理该任务' }
  }
  if (isInstanceBusy(instance.status)) {
    return { status: 'skipped', message: `实例当前状态为 ${instance.status}，已跳过本次执行` }
  }

  switch (task.kind) {
    case 'backup': {
      const result = await createInstanceBackup({
        app,
        instanceId: task.instanceId,
        kind: 'scheduled',
        note: '计划任务自动备份',
        createdBy: SCHEDULED_OPERATOR,
        // 运行中实例先 c_save() 热备份；未运行实例自动降级为直接打包（与自动备份钩子语义一致）
        saveBeforeArchive: true,
      })
      const instanceLabel = instance.name
      emitPanelEvent({
        type: result.ok ? 'backup_completed' : 'backup_failed',
        subjectId: task.instanceId,
        subjectName: instanceLabel,
        message: result.ok
          ? `实例「${instanceLabel}」计划备份完成`
          : `实例「${instanceLabel}」计划备份失败：${result.message ?? '未知原因'}`,
        severity: result.ok ? 'info' : 'warning',
        at: new Date().toISOString(),
      })
      if (!result.ok) {
        return { status: 'failed', message: result.message ?? '计划备份创建失败' }
      }
      return { status: 'ok', message: `备份已创建：${result.backup?.id ?? ''}` }
    }
    case 'restart': {
      const result = await restartInstanceBySchedule(app, task.instanceId)
      if (!result.ok) {
        return { status: 'failed', message: result.message ?? '计划重启失败' }
      }
      return { status: 'ok', message: '实例已按计划重启' }
    }
    case 'update_check': {
      const steamcmdCommand = await resolveSteamcmdCommandForUpdateCheck()
      const status = enqueueInstanceUpdateCheck({
        steamcmdCommand,
        instanceIds: [task.instanceId],
        force: false,
      })
      if (!status.checking && status.error) {
        return { status: 'failed', message: status.error }
      }
      return { status: 'ok', message: '更新检查已触发（结果见实例更新状态）' }
    }
    default:
      return { status: 'failed', message: `未知任务类型：${task.kind}` }
  }
}

/** 供「立即执行」与调度器共用的任务类型与实例匹配校验 */
export function validateTaskTarget(task: Pick<DbScheduledTask, 'kind' | 'instanceId'>): string | null {
  if (task.kind === 'db_snapshot') {
    return null
  }
  return task.instanceId === DB_BACKUP_INSTANCE_ID ? '该任务类型必须绑定具体实例' : null
}
