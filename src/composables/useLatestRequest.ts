import { onScopeDispose, shallowRef } from 'vue'

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 仅允许最后一次请求提交结果，适用于搜索、刷新和路由参数切换。 */
export function useLatestRequest() {
  const pending = shallowRef(false)
  let controller: AbortController | null = null
  let version = 0

  async function execute<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    controller?.abort()
    controller = new AbortController()
    const currentController = controller
    const currentVersion = ++version
    pending.value = true
    try {
      const result = await request(currentController.signal)
      return currentVersion === version ? result : undefined
    }
    catch (error) {
      if (isAbortError(error) || currentVersion !== version) {
        return undefined
      }
      throw error
    }
    finally {
      if (currentVersion === version) {
        pending.value = false
      }
    }
  }

  function cancel() {
    version += 1
    controller?.abort()
    controller = null
    pending.value = false
  }

  onScopeDispose(cancel)

  return { pending, execute, cancel }
}
