import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeDownloadProgress, formatSize } from './downloadProgress.ts'

const MB = 1024 * 1024
const GB = 1024 * MB

describe('formatSize', () => {
  it('scales by unit and keeps a stable precision', () => {
    assert.equal(formatSize(512), '0.5 KB')
    assert.equal(formatSize(1536), '1.5 KB')
    assert.equal(formatSize(1.5 * MB), '1.5 MB')
    assert.equal(formatSize(2 * GB), '2.00 GB')
  })

  it('shows a placeholder when there is no size to show', () => {
    assert.equal(formatSize(0), '—')
    assert.equal(formatSize(-1), '—')
  })
})

describe('describeDownloadProgress', () => {
  it('reports bytes and percent against the known total', () => {
    assert.equal(describeDownloadProgress(0, 100 * MB), '已接收 0 KB / 100.0 MB（0%）')
    assert.equal(describeDownloadProgress(50 * MB, 100 * MB), '已接收 50.0 MB / 100.0 MB（50%）')
  })

  /** 大小记录与实际磁盘大小可能有偏差：宁可停在 99%，也不要显示成已完成 */
  it('clamps the percent to 99 even when the record underestimates', () => {
    assert.equal(describeDownloadProgress(99.9 * MB, 100 * MB), '已接收 99.9 MB / 100.0 MB（99%）')
    assert.equal(describeDownloadProgress(200 * MB, 100 * MB), '已接收 200.0 MB / 100.0 MB（99%）')
  })

  it('falls back to received bytes when the total is unknown', () => {
    assert.equal(describeDownloadProgress(12 * MB, 0), '已接收 12.0 MB')
  })
})
