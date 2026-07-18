import { computed, ref, type Ref } from 'vue'

export interface AdminPageStateOptions {
  /** 是否在 loading 时仍展示已有数据（表格刷新场景） */
  keepContentWhileLoading?: Ref<boolean>
}

export interface AdminEmptyAction {
  label: string
  onClick: () => void
}

/**
 * 管理后台列表/详情页统一三态：loading、empty、error。
 * 表格区优先用 NDataTable :loading；整页首次加载用 showPageSkeleton。
 */
export function useAdminPageState<T>(
  data: Ref<T[] | T | null | undefined>,
  options: AdminPageStateOptions = {},
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

  const showPageSkeleton = computed(() => {
    if (options.keepContentWhileLoading?.value && initialLoadDone.value) {
      return false
    }
    return loading.value && !initialLoadDone.value
  })

  const showTableLoading = computed(() => loading.value && initialLoadDone.value)

  const showEmpty = computed(() => !loading.value && !error.value && isEmpty.value && initialLoadDone.value)

  const showError = computed(() => !loading.value && Boolean(error.value))

  const showContent = computed(() => {
    if (showPageSkeleton.value || showError.value || showEmpty.value) {
      return false
    }
    return !isEmpty.value || (options.keepContentWhileLoading?.value && initialLoadDone.value)
  })

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

  function clearError() {
    error.value = null
  }

  return {
    loading,
    error,
    initialLoadDone,
    isEmpty,
    showPageSkeleton,
    showTableLoading,
    showEmpty,
    showError,
    showContent,
    runLoad,
    clearError,
  }
}
