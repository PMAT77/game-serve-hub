import { useRafFn } from '@vueuse/core'
import { onUnmounted, ref } from 'vue'

/** 装饰形状上下浮动 */
export function useFloatMotion(amplitude = 15, periodSec = 12) {
  const offset = ref(0)
  const startAt = performance.now()

  const { pause } = useRafFn(() => {
    const elapsed = (performance.now() - startAt) / 1000
    offset.value = Math.sin((elapsed * Math.PI * 2) / periodSec) * amplitude
  })

  onUnmounted(pause)

  return { offset }
}
