import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizePanelVersion,
  readBuiltPanelVersion,
  resolvePanelVersionMismatch,
} from './panelVersionGuard.ts'

describe('normalizePanelVersion', () => {
  it('strips the v prefix and whitespace so package.json and release tags compare equal', () => {
    assert.equal(normalizePanelVersion('v0.6.15'), '0.6.15')
    assert.equal(normalizePanelVersion(' 0.6.15 '), '0.6.15')
    assert.equal(normalizePanelVersion('V0.6.15'), '0.6.15')
    assert.equal(normalizePanelVersion(null), '')
    assert.equal(normalizePanelVersion(undefined), '')
  })
})

describe('resolvePanelVersionMismatch', () => {
  it('reports a stale page when the running panel is newer', () => {
    const mismatch = resolvePanelVersionMismatch('0.6.15', 'v0.6.16')
    assert.deepEqual(mismatch, {
      builtVersion: '0.6.15',
      runningVersion: '0.6.16',
      stale: true,
    })
  })

  it('reports no mismatch when versions agree, regardless of the v prefix', () => {
    assert.deepEqual(resolvePanelVersionMismatch('0.6.15', 'v0.6.15'), {
      builtVersion: '0.6.15',
      runningVersion: '0.6.15',
      stale: false,
    })
  })

  it('never guesses when either side is unknown', () => {
    // 开发构建、未设置 GSH_RELEASE_VERSION 的部署、/health 取不到：一律不提示
    assert.equal(resolvePanelVersionMismatch('', 'v0.6.15'), null)
    assert.equal(resolvePanelVersionMismatch('0.6.15', null), null)
    assert.equal(resolvePanelVersionMismatch('0.6.15', ''), null)
    assert.equal(resolvePanelVersionMismatch(null, undefined), null)
  })
})

describe('readBuiltPanelVersion', () => {
  it('returns an empty version when the build-time constant is absent (dev / tests)', () => {
    // 单元测试里没有 vite define 注入，读到空串即代表「不判定」，且不能抛错
    assert.equal(readBuiltPanelVersion(), '')
  })
})
