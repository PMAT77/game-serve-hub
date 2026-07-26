import { computed, shallowRef } from 'vue'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 配置页的远端快照与本地草稿边界。只有成功加载后才会生成草稿。 */
export function useConfigDraft<T>() {
  const snapshot = shallowRef<T | null>(null)
  const draft = shallowRef<T | null>(null)
  const dirty = computed(() => snapshot.value != null && draft.value != null && !sameValue(snapshot.value, draft.value))

  function initialize(value: T) {
    snapshot.value = clone(value)
    draft.value = clone(value)
  }

  function reset() {
    if (snapshot.value != null) {
      draft.value = clone(snapshot.value)
    }
  }

  function commit(value?: T) {
    const next = value ?? draft.value
    if (next == null) {
      return
    }
    snapshot.value = clone(next)
    draft.value = clone(next)
  }

  function clear() {
    snapshot.value = null
    draft.value = null
  }

  return { snapshot, draft, dirty, initialize, reset, commit, clear }
}
