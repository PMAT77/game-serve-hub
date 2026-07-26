import { computed, shallowRef } from 'vue'

export type OperationStatus = 'idle' | 'running' | 'success' | 'error'

export interface OperationState {
  key: string
  status: OperationStatus
  phase: string | null
  percent: number | null
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface StartOperationOptions {
  phase?: string | null
  percent?: number | null
}

function createIdleOperation(key: string): OperationState {
  return {
    key,
    status: 'idle',
    phase: null,
    percent: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'object' && error && 'error' in error) {
    return String((error as { error?: unknown }).error ?? '操作失败，请稍后重试')
  }
  return '操作失败，请稍后重试'
}

/**
 * 管理同一资源操作的唯一进行态。调用方以 `resourceType:id:action` 作为 key，
 * 不同资源可并行，同一 key 在运行期间会被拒绝重复启动。
 */
export function useOperationState() {
  const records = shallowRef(new Map<string, OperationState>())

  function get(key: string): OperationState {
    return records.value.get(key) ?? createIdleOperation(key)
  }

  function set(key: string, next: OperationState) {
    const updated = new Map(records.value)
    updated.set(key, next)
    records.value = updated
  }

  function isRunning(key: string): boolean {
    return get(key).status === 'running'
  }

  function start(key: string, options: StartOperationOptions = {}): boolean {
    if (isRunning(key)) {
      return false
    }
    set(key, {
      ...createIdleOperation(key),
      status: 'running',
      phase: options.phase ?? null,
      percent: options.percent ?? null,
      startedAt: Date.now(),
    })
    return true
  }

  function update(key: string, options: Pick<StartOperationOptions, 'phase' | 'percent'>) {
    const current = get(key)
    if (current.status !== 'running') {
      return
    }
    set(key, {
      ...current,
      phase: options.phase ?? current.phase,
      percent: options.percent ?? current.percent,
    })
  }

  function succeed(key: string) {
    const current = get(key)
    set(key, {
      ...current,
      status: 'success',
      percent: current.percent == null ? null : 100,
      error: null,
      finishedAt: Date.now(),
    })
  }

  function fail(key: string, error: unknown) {
    const current = get(key)
    set(key, {
      ...current,
      status: 'error',
      error: normalizeError(error),
      finishedAt: Date.now(),
    })
  }

  function reset(key: string) {
    const updated = new Map(records.value)
    updated.delete(key)
    records.value = updated
  }

  async function run<T>(key: string, task: () => Promise<T>, options?: StartOperationOptions): Promise<T | undefined> {
    if (!start(key, options)) {
      return undefined
    }
    try {
      const result = await task()
      succeed(key)
      return result
    }
    catch (error) {
      fail(key, error)
      throw error
    }
  }

  return {
    records: computed(() => [...records.value.values()]),
    get,
    isRunning,
    start,
    update,
    succeed,
    fail,
    reset,
    run,
  }
}
