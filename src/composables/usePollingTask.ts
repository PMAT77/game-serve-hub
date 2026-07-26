import { onScopeDispose, shallowRef } from 'vue'

export interface PollingTaskOptions {
  intervalMs?: number
  immediate?: boolean
}

/** 带取消、in-flight 防重和作用域清理的轮询任务。 */
export function usePollingTask(task: (signal: AbortSignal) => Promise<void>, options: PollingTaskOptions = {}) {
  const running = shallowRef(false)
  const polling = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const intervalMs = options.intervalMs ?? 5000
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  async function execute() {
    if (!polling.value || running.value) {
      return
    }
    controller?.abort()
    controller = new AbortController()
    const activeController = controller
    running.value = true
    try {
      await task(activeController.signal)
      error.value = null
    }
    catch (reason) {
      if (!activeController.signal.aborted) {
        error.value = reason instanceof Error ? reason.message : '轮询失败，请稍后重试'
      }
    }
    finally {
      if (controller === activeController) {
        running.value = false
      }
      if (polling.value) {
        clearTimer()
        timer = setTimeout(() => void execute(), intervalMs)
      }
    }
  }

  function start() {
    if (polling.value) {
      return
    }
    polling.value = true
    if (options.immediate !== false) {
      void execute()
    }
    else {
      timer = setTimeout(() => void execute(), intervalMs)
    }
  }

  function stop() {
    polling.value = false
    clearTimer()
    controller?.abort()
    controller = null
    running.value = false
  }

  onScopeDispose(stop)

  return { running, polling, error, start, stop, refresh: execute }
}
