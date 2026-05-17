import { computed, onMounted, ref } from 'vue'

/** 入场淡入上移动画（用于 inline style，避免依赖动态 UnoCSS class） */
export function useFadeUp(transitionDelay = 0, enterDelay = 0) {
  const visible = ref(false)

  onMounted(() => {
    window.setTimeout(() => {
      visible.value = true
    }, enterDelay)
  })

  const style = computed(() => ({
    transform: visible.value ? 'translateY(0)' : 'translateY(24px)',
    opacity: visible.value ? 1 : 0,
    transition: `transform 1s cubic-bezier(0.25, 0.4, 0.25, 1) ${transitionDelay}s, opacity 1s cubic-bezier(0.25, 0.4, 0.25, 1) ${transitionDelay}s`,
  }))

  return { visible, style }
}
