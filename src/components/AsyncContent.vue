<script setup lang="ts">
import { NAlert, NButton, NEmpty, NSkeleton } from 'naive-ui'

defineOptions({ name: 'AsyncContent' })

withDefaults(defineProps<{
  loading?: boolean
  refreshing?: boolean
  error?: string | null
  empty?: boolean
  skeletonRows?: number
  emptyDescription?: string
}>(), {
  skeletonRows: 6,
  emptyDescription: '暂无数据',
})

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="loading" class="space-y-3" aria-busy="true" aria-label="加载中">
    <NSkeleton v-for="i in skeletonRows" :key="i" text :style="{ width: i === skeletonRows ? '60%' : '100%' }" />
  </div>
  <div v-else-if="error" class="space-y-3" role="alert">
    <NAlert type="error" title="加载失败">
      {{ error }}
    </NAlert>
    <NButton size="small" @click="emit('retry')">
      重试
    </NButton>
  </div>
  <NEmpty v-else-if="empty" :description="emptyDescription" />
  <div v-else :aria-busy="refreshing || undefined">
    <slot />
  </div>
</template>
