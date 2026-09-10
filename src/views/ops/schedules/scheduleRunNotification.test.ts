import type { ScheduleTaskItem } from '@/api/modules/schedule'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildScheduleTriggerNotice, collectScheduleTriggerNotices, defaultScheduleTargetName } from './scheduleRunNotification.ts'

function makeTask(overrides: Partial<ScheduleTaskItem> & Pick<ScheduleTaskItem, 'id'>): ScheduleTaskItem {
  return {
    instanceId: 'inst-1',
    kind: 'backup',
    scheduleType: 'daily',
    scheduleValue: '04:30',
    scheduleTimezone: 'beijing',
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    nextRunAt: null,
    createdBy: 'admin',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const TRIGGERED_AT = '2026-09-16T20:30:00.000Z'

describe('collectScheduleTriggerNotices', () => {
  it('首次采集只建立基线，不为历史执行弹通知', () => {
    const task = makeTask({ id: 'st-1', lastRunAt: '2026-09-15T20:30:00.000Z', lastRunStatus: 'ok' })
    const result = collectScheduleTriggerNotices(new Map(), [task])
    assert.equal(result.notices.length, 0)
    assert.equal(result.baseline.get('st-1'), '2026-09-15T20:30:00.000Z')
  })

  it('lastRunAt 出现新值即视为一次触发', () => {
    const previous = new Map([['st-1', '2026-09-15T20:30:00.000Z']])
    const task = makeTask({
      id: 'st-1',
      instanceId: 'inst-1',
      kind: 'restart',
      lastRunAt: TRIGGERED_AT,
      lastRunStatus: 'ok',
      lastRunMessage: '实例已按计划重启',
    })
    const result = collectScheduleTriggerNotices(previous, [task], () => '生存服')
    assert.equal(result.notices.length, 1)
    assert.equal(result.notices[0].taskId, 'st-1')
    assert.equal(result.notices[0].title, '计划任务已触发')
    assert.equal(result.notices[0].content, '定时重启｜生存服：成功 · 实例已按计划重启')
    assert.equal(result.notices[0].level, 'success')
    assert.equal(result.notices[0].durationMs, 6000)
    assert.equal(result.baseline.get('st-1'), TRIGGERED_AT)
  })

  it('终态写回复用触发时刻，同一任务不会重复通知', () => {
    const running = makeTask({ id: 'st-1', lastRunAt: TRIGGERED_AT, lastRunStatus: 'running', lastRunMessage: '执行中…' })
    const finished = makeTask({ id: 'st-1', lastRunAt: TRIGGERED_AT, lastRunStatus: 'ok', lastRunMessage: '备份已创建：bk-1' })
    const previous = new Map([['st-1', '2026-09-15T20:30:00.000Z']])

    const first = collectScheduleTriggerNotices(previous, [running])
    assert.equal(first.notices.length, 1)
    assert.equal(first.notices[0].level, 'info')

    const second = collectScheduleTriggerNotices(first.baseline, [finished])
    assert.equal(second.notices.length, 0, 'same lastRunAt must not notify twice')
  })

  it('失败与跳过使用更醒目的通知等级，且只在 running→其它状态时报告一次', () => {
    const failed = buildScheduleTriggerNotice(makeTask({ id: 'st-1', lastRunAt: TRIGGERED_AT, lastRunStatus: 'failed', lastRunMessage: '实例当前状态为 running，已跳过本次执行' }), '生存服')
    assert.equal(failed.level, 'error')
    assert.equal(failed.durationMs, 8000)

    const skipped = buildScheduleTriggerNotice(makeTask({ id: 'st-2', lastRunAt: TRIGGERED_AT, lastRunStatus: 'skipped', lastRunMessage: '实例不存在（可能已删除），请清理该任务' }), '生存服')
    assert.equal(skipped.level, 'warning')
    assert.equal(skipped.durationMs, 6000)
  })

  it('尚未执行过的任务不产生通知，任务删除后基线不残留', () => {
    const previous = new Map([['st-1', null], ['st-2', TRIGGERED_AT]])
    const result = collectScheduleTriggerNotices(previous, [makeTask({ id: 'st-1' })])
    assert.equal(result.notices.length, 0)
    assert.deepEqual([...result.baseline.keys()], ['st-1'])
  })

  it('面板数据库任务显示固定中文目标名', () => {
    assert.equal(defaultScheduleTargetName('panel-db'), '面板数据库')
    assert.equal(defaultScheduleTargetName('inst-1'), 'inst-1')
    const notice = buildScheduleTriggerNotice(
      makeTask({ id: 'st-3', instanceId: 'panel-db', kind: 'db_snapshot', lastRunAt: TRIGGERED_AT, lastRunStatus: 'ok' }),
      defaultScheduleTargetName('panel-db'),
    )
    assert.equal(notice.content, '数据库快照｜面板数据库：成功')
  })
})
