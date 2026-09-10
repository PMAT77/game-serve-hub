import type { DbScheduleType } from '../../shared/db/index'

export const INTERVAL_MIN_HOURS = 1
export const INTERVAL_MAX_HOURS = 168

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 解析 interval 小时数；非法返回 null */
export function parseIntervalHours(scheduleValue: string): number | null {
  if (!/^\d+$/.test(scheduleValue.trim())) {
    return null
  }
  const hours = Number.parseInt(scheduleValue.trim(), 10)
  if (!Number.isInteger(hours) || hours < INTERVAL_MIN_HOURS || hours > INTERVAL_MAX_HOURS) {
    return null
  }
  return hours
}

/** 解析 daily HH:MM；非法返回 null */
export function parseDailyTime(scheduleValue: string): { hour: number, minute: number } | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(scheduleValue.trim())
  if (!match) {
    return null
  }
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/**
 * 计算下一次执行时间（服务器本地时区）。
 * - interval：from + N 小时
 * - daily：最近的未来一个 HH:MM（今天未过则今天，否则明天）
 * from 之后一毫秒内的边界视为已过期，保证「整点任务不立即重复执行」。
 */
export function computeNextRunAt(scheduleType: DbScheduleType, scheduleValue: string, from: Date): Date | null {
  if (scheduleType === 'interval') {
    const hours = parseIntervalHours(scheduleValue)
    if (hours === null) {
      return null
    }
    return new Date(from.getTime() + hours * 60 * 60 * 1000)
  }
  const daily = parseDailyTime(scheduleValue)
  if (daily === null) {
    return null
  }
  const next = new Date(from)
  next.setHours(daily.hour, daily.minute, 0, 0)
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

/** 计算并返回 ISO 字符串；scheduleValue 非法时返回 null（由调用方决定拒绝或告警） */
export function computeNextRunAtIso(scheduleType: DbScheduleType, scheduleValue: string, from: Date): string | null {
  const next = computeNextRunAt(scheduleType, scheduleValue, from)
  return next ? next.toISOString() : null
}

/** 人类可读描述（UI 与通知复用） */
export function describeSchedule(scheduleType: DbScheduleType, scheduleValue: string): string {
  if (scheduleType === 'interval') {
    const hours = parseIntervalHours(scheduleValue)
    return hours === null ? '每 ? 小时' : `每 ${hours} 小时`
  }
  const daily = parseDailyTime(scheduleValue)
  return daily === null ? '每日 ??:??' : `每日 ${pad2(daily.hour)}:${pad2(daily.minute)}`
}
