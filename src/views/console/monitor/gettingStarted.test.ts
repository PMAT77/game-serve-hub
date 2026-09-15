import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  GETTING_STARTED_MOD_STEP,
  GETTING_STARTED_STEPS,
  getGettingStartedDismissKey,
  isGettingStartedDismissed,
  resolveGettingStartedProgress,
  setGettingStartedDismissed,
} from './gettingStarted'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  } as Storage
}

describe('getting started dismiss storage', () => {
  const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  function installStorage() {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    })
  }

  afterEach(() => {
    if (originalLocal) {
      Object.defineProperty(globalThis, 'localStorage', originalLocal)
    }
    else {
      delete (globalThis as Record<string, unknown>).localStorage
    }
  })

  it('remembers the dismissal per account', () => {
    installStorage()
    assert.equal(isGettingStartedDismissed('alice'), false)
    setGettingStartedDismissed('alice')
    assert.equal(localStorage.getItem(getGettingStartedDismissKey('alice')), '1')
    assert.equal(isGettingStartedDismissed('alice'), true)
    // 换账号登录应当重新看到引导
    assert.equal(isGettingStartedDismissed('bob'), false)
  })

  it('falls back to a shared key when the account is empty', () => {
    installStorage()
    assert.equal(getGettingStartedDismissKey('   '), getGettingStartedDismissKey(''))
    setGettingStartedDismissed('')
    assert.equal(isGettingStartedDismissed('   '), true)
  })
})

describe('resolveGettingStartedProgress', () => {
  it('starts from creating an instance', () => {
    const progress = resolveGettingStartedProgress({ instanceCount: 0, runningInstanceCount: 0 })
    assert.equal(progress.currentStepId, 'create-instance')
    assert.deepEqual(progress.completedStepIds, ['check-environment'])
    assert.match(progress.summary, /还没有实例/)
  })

  it('moves on to room configuration once an instance exists', () => {
    const progress = resolveGettingStartedProgress({ instanceCount: 2, runningInstanceCount: 0 })
    assert.equal(progress.currentStepId, 'configure-room')
    assert.deepEqual(progress.completedStepIds, ['check-environment', 'create-instance'])
  })

  it('points at backups once something is running', () => {
    const progress = resolveGettingStartedProgress({ instanceCount: 2, runningInstanceCount: 1 })
    assert.equal(progress.currentStepId, 'schedule-backup')
    assert.ok(progress.completedStepIds.includes('start-instance'))
    assert.match(progress.summary, /计划任务/)
  })

  it('never claims a step that the panel cannot observe', () => {
    const idle = resolveGettingStartedProgress({ instanceCount: 1, runningInstanceCount: 0 })
    // 「房间是否配好」「世界是否调过」需要额外请求，界面不据此标完成
    assert.equal(idle.completedStepIds.includes('configure-room'), false)
    assert.equal(idle.completedStepIds.includes('configure-world'), false)
  })

  it('keeps step ids unique and covered by the progress rules', () => {
    const ids = GETTING_STARTED_STEPS.map(step => step.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const state of [
      { instanceCount: 0, runningInstanceCount: 0 },
      { instanceCount: 1, runningInstanceCount: 0 },
      { instanceCount: 1, runningInstanceCount: 1 },
    ]) {
      const progress = resolveGettingStartedProgress(state)
      assert.ok(ids.includes(progress.currentStepId), progress.currentStepId)
      for (const completed of progress.completedStepIds) {
        assert.ok(ids.includes(completed), completed)
      }
    }
    assert.equal(ids.includes(GETTING_STARTED_MOD_STEP.id), false)
    assert.ok(GETTING_STARTED_MOD_STEP.to)
  })
})
