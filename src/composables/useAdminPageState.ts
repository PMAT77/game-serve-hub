import { computed, ref, type Ref } from 'vue'

/**
 * 管理后台列表/详情页统一三态：loading、empty、error。
 * 表格加载用 NDataTable :loading；空态用 NDataTable #empty 插槽 / NEmpty；错误态用 NAlert + 重试。
 */
export function useAdminPageState<T>(
  data: Ref<T[] | T | null | undefined>,
) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const initialLoadDone = ref(false)

  const isEmpty = computed(() => {
    const value = data.value
    if (value == null) {
      return true
    }
    if (Array.isArray(value)) {
      return value.length === 0
    }
    return false
  })

  const showEmpty = computed(() => !loading.value && !error.value && isEmpty.value && initialLoadDone.value)

  const showError = computed(() => !loading.value && Boolean(error.value))

  async function runLoad<T>(loader: () => Promise<T>): Promise<T | undefined> {
    loading.value = true
    error.value = null
    try {
      const result = await loader()
      initialLoadDone.value = true
      return result
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : '加载失败，请稍后重试'
      initialLoadDone.value = true
      return undefined
    }
    finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    initialLoadDone,
    showEmpty,
    showError,
    runLoad,
  }
}
