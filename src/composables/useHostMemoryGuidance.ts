import type { HostMemoryGuidancePayload } from '@/types/host-memory-guidance'
import apiSystem from '@/api/modules/system'
import { onMounted, ref } from 'vue'

export function useHostMemoryGuidance(options?: { loadOnMount?: boolean }) {
  const guidance = ref<HostMemoryGuidancePayload | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const res = await apiSystem.getSystemInfo()
      guidance.value = res.data.memoryGuidance ?? null
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : '内存档位加载失败'
      guidance.value = null
    }
    finally {
      loading.value = false
    }
  }

  if (options?.loadOnMount !== false) {
    onMounted(() => {
      void refresh()
    })
  }

  return {
    guidance,
    loading,
    error,
    refresh,
  }
}
