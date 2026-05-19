import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collapseRedundantSteamProgressLines,
  formatInstallLogContent,
  parseSteamcmdProgressPercent,
} from './log-format.ts'

describe('parseSteamcmdProgressPercent', () => {
  it('parses bracket percent', () => {
    assert.equal(parseSteamcmdProgressPercent(' Update state (0x61) downloading, [ 42%]'), 42)
  })

  it('parses progress colon percent', () => {
    assert.equal(
      parseSteamcmdProgressPercent(' Update state (0x61) downloading, progress: 45.23 (1 / 2)'),
      45,
    )
  })
})

describe('formatInstallLogContent', () => {
  it('normalizes carriage returns and control chars', () => {
    const formatted = formatInstallLogContent('\u0001ERROR!\r\nline two\r\n\r\n\r\nline three')
    assert.equal(formatted, 'ERROR!\nline two\n\nline three')
  })

  it('strips orphaned ANSI and collapses duplicate progress lines', () => {
    const raw = [
      '[0m Update state (0x61) downloading, progress: 50.00 (1 / 2)',
      '[0m Update state (0x61) downloading, progress: 99.00 (1 / 2)',
      'Success! App \'343050\' fully installed.',
    ].join('\n')
    const formatted = formatInstallLogContent(raw)
    assert.equal(
      formatted,
      'Update state (0x61) downloading, progress: 99.00 (1 / 2)\nSuccess! App \'343050\' fully installed.',
    )
  })
})

describe('collapseRedundantSteamProgressLines', () => {
  it('keeps only the latest line per state phase', () => {
    const lines = [
      'Update state (0x61) downloading, progress: 10.00',
      'Update state (0x61) downloading, progress: 90.00',
      'Update state (0x81) verifying update, progress: 50.00',
      'Update state (0x81) verifying update, progress: 80.00',
      'Done',
    ]
    assert.deepEqual(collapseRedundantSteamProgressLines(lines), [
      'Update state (0x61) downloading, progress: 90.00',
      'Update state (0x81) verifying update, progress: 80.00',
      'Done',
    ])
  })
})
