<script setup lang="ts">
import { NAlert } from 'naive-ui'

defineOptions({
  name: 'AppHostMemoryAlert',
})

withDefaults(defineProps<{
  title?: string
  message: string
  type?: 'warning' | 'info'
}>(), {
  type: 'warning',
})
</script>

<template>
  <NAlert :type="type" :title="title" class="mb-3">
    <p class="text-sm leading-relaxed">
      {{ message }}
    </p>
  </NAlert>
</template>
