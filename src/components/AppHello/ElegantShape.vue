<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useFloatMotion } from './composables/useFloatMotion'
import type { ShapeVariant } from './types'
import { SHAPE_VARIANT_COLOR } from './types'

defineOptions({
  name: 'AppHelloElegantShape',
})

interface Props {
  delay?: number
  width?: number
  height?: number
  rotate?: number
  variant?: ShapeVariant
}

const props = withDefaults(defineProps<Props>(), {
  delay: 0,
  width: 400,
  height: 100,
  rotate: 0,
  variant: 'indigo',
})

const isVisible = ref(false)
const { offset: floatOffset } = useFloatMotion()

let showTimer: ReturnType<typeof window.setTimeout> | undefined

const initialRotate = computed(() => props.rotate - 15)

onMounted(() => {
  showTimer = window.setTimeout(() => {
    isVisible.value = true
  }, props.delay * 1000)
})

onUnmounted(() => {
  if (showTimer !== undefined) {
    window.clearTimeout(showTimer)
  }
})

const containerStyle = computed(() => ({
  transform: isVisible.value
    ? `translateY(0) rotate(${props.rotate}deg)`
    : `translateY(-150px) rotate(${initialRotate.value}deg)`,
  opacity: isVisible.value ? 1 : 0,
  transition: `transform 2.4s cubic-bezier(0.23, 0.86, 0.39, 0.96) ${props.delay}s, opacity 1.2s ease ${props.delay}s`,
}))

const innerStyle = computed(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
  transform: `translateY(${floatOffset.value}px)`,
}))

const fillStyle = computed(() => ({
  backgroundImage: `linear-gradient(to right, ${SHAPE_VARIANT_COLOR[props.variant]}, transparent)`,
}))
</script>

<template>
  <div class="app-hello-shape-root" :style="containerStyle">
    <div class="app-hello-shape-inner" :style="innerStyle">
      <div class="app-hello-shape-surface" :style="fillStyle">
        <div class="app-hello-shape-glow" />
      </div>
    </div>
  </div>
</template>
