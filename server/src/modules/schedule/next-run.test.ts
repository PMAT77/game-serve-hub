import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeNextRunAt,
  computeNextRunAtIso,
  describeSchedule,
  parseDailyTime,
  parseIntervalHours,
} from './next-run'

describe('parseIntervalHours', () => {
  it('accepts 1-168 integer hours', () => {
    assert.equal(parseIntervalHours('1'), 1)
    assert.equal(parseIntervalHours('24'), 24)
    assert.equal(parseIntervalHours('168'), 168)
    assert.equal(parseIntervalHours(' 6 '), 6)
  })

  it('rejects out-of-range and non-numeric values', () => {
    assert.equal(parseIntervalHours('0'), null)
    assert.equal(parseIntervalHours('169'), null)
    assert.equal(parseIntervalHours('abc'), null)
    assert.equal(parseIntervalHours(''), null)
    assert.equal(parseIntervalHours('4.5'), null)
    assert.equal(parseIntervalHours('04:30'), null)
  })
})

describe('parseDailyTime', () => {
  it('accepts HH:MM within a day', () => {
    assert.deepEqual(parseDailyTime('00:00'), { hour: 0, minute: 0 })
    assert.deepEqual(parseDailyTime('04:30'), { hour: 4, minute: 30 })
    assert.deepEqual(parseDailyTime('23:59'), { hour: 23, minute: 59 })
  })

  it('rejects malformed times', () => {
    assert.equal(parseDailyTime('24:00'), null)
    assert.equal(parseDailyTime('12:5'), null)
    assert.equal(parseDailyTime('ab:cd'), null)
    assert.equal(parseDailyTime(''), null)
    assert.equal(parseDailyTime('6'), null)
  })
})

describe('computeNextRunAt', () => {
  it('interval advances exactly N hours', () => {
    const from = new Date('2026-09-15T08:00:00+08:00')
    const next = computeNextRunAt('interval', '6', from)
    assert.equal(next?.getTime(), from.getTime() + 6 * 60 * 60 * 1000)
  })

  it('daily uses today when the time has not passed', () => {
    const from = new Date('2026-09-15T02:00:00')
    const next = computeNextRunAt('daily', '04:30', from)
    assert.equal(next?.getDate(), 15)
    assert.equal(next?.getHours(), 4)
    assert.equal(next?.getMinutes(), 30)
    assert.equal(next?.getSeconds(), 0)
  })

  it('daily rolls to tomorrow when today’s time has passed', () => {
    const from = new Date('2026-09-15T05:00:00')
    const next = computeNextRunAt('daily', '04:30', from)
    assert.equal(next?.getDate(), 16)
    assert.equal(next?.getHours(), 4)
  })

  it('daily rolls to tomorrow when the time equals now (防整点立即重复执行)', () => {
    const from = new Date('2026-09-15T04:30:00')
    const next = computeNextRunAt('daily', '04:30', from)
    assert.equal(next?.getDate(), 16)
  })

  it('daily keeps midnight as next-day boundary edge case', () => {
    const from = new Date('2026-09-15T23:59:59')
    const next = computeNextRunAt('daily', '00:00', from)
    assert.equal(next?.getDate(), 16)
    assert.equal(next?.getHours(), 0)
  })

  it('daily beijing computes fixed UTC+8 regardless of process timezone', () => {
    // 北京时间 2026-09-15 18:00（UTC 10:00）创建 08:40 任务 → 明天北京时间 08:40（UTC 00:40）
    const from = new Date('2026-09-15T10:00:00Z')
    const next = computeNextRunAt('daily', '08:40', from, 'beijing')
    assert.equal(next?.toISOString(), '2026-09-16T00:40:00.000Z')
  })

  it('daily beijing uses today while the beijing time has not passed', () => {
    // 北京时间 2026-09-15 04:00（UTC 前一日 20:00）创建 08:40 任务 → 当天北京时间 08:40
    const from = new Date('2026-09-14T20:00:00Z')
    const next = computeNextRunAt('daily', '08:40', from, 'beijing')
    assert.equal(next?.toISOString(), '2026-09-15T00:40:00.000Z')
  })

  it('daily beijing rolls when the exact beijing time equals now (防整点立即重复执行)', () => {
    const from = new Date('2026-09-15T00:40:00Z')
    const next = computeNextRunAt('daily', '08:40', from, 'beijing')
    assert.equal(next?.toISOString(), '2026-09-16T00:40:00.000Z')
  })

  it('daily server keeps local-timezone behaviour (默认值向后兼容)', () => {
    const from = new Date('2026-09-15T02:00:00')
    const explicit = computeNextRunAt('daily', '04:30', from, 'server')
    const implicit = computeNextRunAt('daily', '04:30', from)
    assert.equal(explicit?.getTime(), implicit?.getTime())
    assert.equal(explicit?.getDate(), 15)
    assert.equal(explicit?.getHours(), 4)
  })

  it('returns null for invalid schedule values (防御性兜底)', () => {
    assert.equal(computeNextRunAt('interval', '0', new Date()), null)
    assert.equal(computeNextRunAt('daily', '25:00', new Date()), null)
    assert.equal(computeNextRunAtIso('interval', 'abc', new Date()), null)
  })
})

describe('describeSchedule', () => {
  it('formats human-readable text', () => {
    assert.equal(describeSchedule('interval', '6'), '每 6 小时')
    assert.equal(describeSchedule('daily', '04:30'), '每日 04:30（服务器时区）')
    assert.equal(describeSchedule('daily', '9:05'.padStart(5, '0')), '每日 09:05（服务器时区）')
    assert.equal(describeSchedule('daily', '08:40', 'beijing'), '每日 08:40（北京时间）')
  })
})
