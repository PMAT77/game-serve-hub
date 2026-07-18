<script setup lang="ts">
import { NAlert, NButton, NEmpty, NSkeleton, NSpace } from 'naive-ui'

defineOptions({
  name: 'AdminPageFeedback',
})

withDefaults(defineProps<{
  showSkeleton?: boolean
  skeletonRows?: number
  showError?: boolean
  errorMessage?: string | null
  showEmpty?: boolean
  emptyDescription?: string
  emptyActionLabel?: string
}>(), {
  skeletonRows: 6,
  emptyDescription: '暂无数据',
})

const emit = defineEmits<{
  retry: []
  emptyAction: []
}>()
</script>

<template>
  <div v-if="showSkeleton" class="space-y-3" aria-busy="true" aria-label="加载中">
    <NSkeleton v-for="i in skeletonRows" :key="i" text :style="{ width: i === skeletonRows ? '60%' : '100%' }" />
  </div>
  <div v-else-if="showError" class="space-y-3">
    <NAlert type="error" :title="errorMessage || '加载失败'" />
    <NButton size="small" @click="emit('retry')">
      重试
    </NButton>
  </div>
  <NEmpty
    v-else-if="showEmpty"
    :description="emptyDescription"
  >
    <template v-if="emptyActionLabel" #extra>
      <NSpace justify="center">
        <NButton type="primary" @click="emit('emptyAction')">
          {{ emptyActionLabel }}
        </NButton>
      </NSpace>
    </template>
  </NEmpty>
  <slot v-else />
</template>
