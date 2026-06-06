import type { Ref } from 'vue'
import type { InstanceItem, InstanceRuntimeMetrics } from '@/api/modules/instance'
import apiInstance from '@/api/modules/instance'

const INSTANCE_METRICS_POLL_MS = 5000

export function useInstanceRuntimeObservability(instances: Ref<InstanceItem[]>) {
  const instanceMetrics = ref<Record<string, InstanceRuntimeMetrics | null>>({})
  const uptimeNowMs = ref(Date.now())

  let metricsPollingTimer: ReturnType<typeof setInterval> | undefined
  let uptimeTickTimer: ReturnType<typeof setInterval> | undefined

  function stopMetricsPolling() {
    if (metricsPollingTimer) {
      clearInterval(metricsPollingTimer)
      metricsPollingTimer = undefined
    }
  }

  function stopUptimeTick() {
    if (uptimeTickTimer) {
      clearInterval(uptimeTickTimer)
      uptimeTickTimer = undefined
    }
  }

  function stopRuntimeObservability() {
    stopMetricsPolling()
    stopUptimeTick()
  }

  async function fetchInstanceMetrics(options?: { silent?: boolean }) {
    const runningIds = instances.value
      .filter(item => item.status === 'running')
      .map(item => item.id)
    if (runningIds.length === 0) {
      instanceMetrics.value = {}
      return
    }
    try {
      const res = await apiInstance.getInstanceMetrics(runningIds)
      instanceMetrics.value = res.data.items
    }
    catch {
      if (!options?.silent) {
        faToast.error('实例资源指标刷新失败')
      }
    }
  }

  function syncRuntimeObservabilityPolling() {
    const hasRunning = instances.value.some(item => item.status === 'running')
    if (!hasRunning) {
      stopRuntimeObservability()
      instanceMetrics.value = {}
      return
    }
    uptimeNowMs.value = Date.now()
    if (!metricsPollingTimer) {
      void fetchInstanceMetrics({ silent: true })
      metricsPollingTimer = setInterval(() => {
        if (!instances.value.some(item => item.status === 'running')) {
          syncRuntimeObservabilityPolling()
          return
        }
        void fetchInstanceMetrics({ silent: true })
      }, INSTANCE_METRICS_POLL_MS)
    }
    if (!uptimeTickTimer) {
      uptimeTickTimer = setInterval(() => {
        uptimeNowMs.value = Date.now()
        if (!instances.value.some(item => item.status === 'running')) {
          syncRuntimeObservabilityPolling()
        }
      }, 1000)
    }
  }

  function getMetricsForInstance(instanceId: string) {
    return instanceMetrics.value[instanceId] ?? null
  }

  return {
    instanceMetrics,
    uptimeNowMs,
    fetchInstanceMetrics,
    syncRuntimeObservabilityPolling,
    stopRuntimeObservability,
    getMetricsForInstance,
  }
}
