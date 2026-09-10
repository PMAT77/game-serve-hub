import type { ScheduleTaskItem } from '@/api/modules/schedule'

/** 面板数据库哨兵实例 id（与后端 DB_BACKUP_INSTANCE_ID 一致） */
const PANEL_DB_INSTANCE_ID = 'panel-db'

export const SCHEDULE_KIND_LABELS: Record<ScheduleTaskItem['kind'], string> = {
  restart: '定时重启',
  backup: '定时备份',
  update_check: '更新检查',
  db_snapshot: '数据库快照',
}

export const SCHEDULE_STATUS_LABELS: Record<NonNullable<ScheduleTaskItem['lastRunStatus']>, string> = {
  running: '执行中',
  ok: '成功',
  failed: '失败',
  skipped: '跳过',
}

export interface ScheduleTriggerNotice {
  taskId: string
  level: 'success' | 'error' | 'warning' | 'info'
  title: string
  content: string
  durationMs: number
}

/** 触发时刻 → 基线。null 表示该任务尚未执行过 */
export type ScheduleRunBaseline = Map<string, string | null>

export function defaultScheduleTargetName(instanceId: string): string {
  return instanceId === PANEL_DB_INSTANCE_ID ? '面板数据库' : instanceId
}

function noticeLevel(status: NonNullable<ScheduleTaskItem['lastRunStatus']>): ScheduleTriggerNotice['level'] {
  if (status === 'failed') {
    return 'error'
  }
  if (status === 'skipped') {
    return 'warning'
  }
  return status === 'running' ? 'info' : 'success'
}

/** 单条通知文案（任务类型 + 目标 + 状态/结果） */
export function buildScheduleTriggerNotice(task: ScheduleTaskItem, targetName: string): ScheduleTriggerNotice {
  const status = task.lastRunStatus ?? 'ok'
  const detail = task.lastRunMessage?.trim() ? ` · ${task.lastRunMessage}` : ''
  return {
    taskId: task.id,
    level: noticeLevel(status),
    title: '计划任务已触发',
    content: `${SCHEDULE_KIND_LABELS[task.kind]}｜${targetName}：${SCHEDULE_STATUS_LABELS[status]}${detail}`,
    durationMs: status === 'failed' ? 8000 : 6000,
  }
}

/**
 * 依据上一次基线找出「新触发」的任务：某任务的 lastRunAt 相对基线出现了新值。
 * 传空基线时为首次采集（只建立基线，不产生通知）。
 * 调度器在终态写回时复用触发时刻，因此一次执行只会产生一条通知。
 */
export function collectScheduleTriggerNotices(
  previous: ReadonlyMap<string, string | null>,
  tasks: ScheduleTaskItem[],
  resolveTargetName: (instanceId: string) => string = defaultScheduleTargetName,
): { notices: ScheduleTriggerNotice[], baseline: ScheduleRunBaseline } {
  const notices: ScheduleTriggerNotice[] = []
  const baseline: ScheduleRunBaseline = new Map()
  for (const task of tasks) {
    const lastRunAt = task.lastRunAt ?? null
    const previousRunAt = previous.get(task.id) ?? null
    if (previous.has(task.id) && lastRunAt !== null && lastRunAt !== previousRunAt) {
      notices.push(buildScheduleTriggerNotice(task, resolveTargetName(task.instanceId)))
    }
    baseline.set(task.id, lastRunAt)
  }
  return { notices, baseline }
}
