<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NProgress, NSkeleton } from 'naive-ui'

defineOptions({
  name: 'SystemLoadCard',
})

const props = withDefaults(defineProps<{
  loading: boolean
  info: SystemInfoData | null
  mode?: 'info' | 'charts'
}>(), {
  mode: 'info',
})

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

const normalizedLoad = computed(() => {
  const oneMinuteLoad = props.info?.load?.oneMinute ?? 0
  const cores = Math.max(1, props.info?.cpu?.cores ?? 1)
  return oneMinuteLoad / cores
})

const loadPercent = computed(() => {
  const usageRate = props.info?.load?.usageRate
  // 兼容后端旧数据未返回 usageRate 的场景，前端按 1m 负载兜底换算。
  if (typeof usageRate === 'number') {
    return clampPercent(usageRate)
  }
  return clampPercent(normalizedLoad.value * 100)
})

const isWindowsSyntheticLoad = computed(() => props.info?.load?.isSynthetic === true)

const loadStatusText = computed(() => {
  if (!props.info || props.loading) {
    return '不可用'
  }
  if (loadPercent.value < 40) {
    return '运行流畅'
  }
  if (loadPercent.value < 70) {
    return '轻微负载'
  }
  if (loadPercent.value < 100) {
    return '负载较高'
  }
  return '运行卡顿'
})

const loadStatusColor = computed(() => {
  if (loadStatusText.value === '运行流畅') {
    return '#10b981'
  }
  if (loadStatusText.value === '轻微负载') {
    return '#f59e0b'
  }
  if (loadStatusText.value === '负载较高') {
    return '#f97316'
  }
  if (loadStatusText.value === '运行卡顿') {
    return '#ef4444'
  }
  return '#94a3b8'
})
</script>

<template>
  <div v-if="mode === 'info'" class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      负载
    </div>
    <div>
      <div class="font-semibold">
        <NSkeleton v-if="loading" text animated :sharp="false" width="220px" />
        <template v-else-if="isWindowsSyntheticLoad">
          综合压力 {{ loadPercent.toFixed(2) }}% · CPU队列 {{ info?.load?.cpuQueueLength ?? '--' }} · 磁盘队列 {{ info?.load?.diskQueueLength ?? '--' }}
        </template>
        <template v-else>
          1m {{ info?.load?.oneMinute ?? '--' }} / 5m {{ info?.load?.fiveMinutes ?? '--' }} / 15m {{ info?.load?.fifteenMinutes ?? '--' }}
        </template>
      </div>
      <div class="text-xs text-muted-foreground mt-1">
        <NSkeleton v-if="loading" text animated :repeat="1" :sharp="false" width="120px" />
        <template v-else>
          归一化占用率 {{ loadPercent.toFixed(2) }}%
        </template>
      </div>
    </div>
  </div>

  <div v-if="mode === 'charts'" class="p-3 rounded-lg flex flex-col cursor-pointer items-center justify-center">
    <NProgress
      type="circle"
      :percentage="loadPercent"
      :color="loadStatusColor"
      :height="110"
      :stroke-width="8"
      :offset-degree="180"
      :show-indicator="true"
    >
      <n-space vertical align="center">
        <span class="text-lg text-muted-foreground">
          {{ loadPercent.toFixed(2) }}%
        </span>
        <span class="text-xs text-muted-foreground">
          负载
        </span>
      </n-space>
    </NProgress>
    <span class="text-xs text-muted-foreground mt-4">{{ loadStatusText }}</span>
  </div>
</template>
