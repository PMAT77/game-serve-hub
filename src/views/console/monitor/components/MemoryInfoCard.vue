<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NProgress, NSkeleton } from 'naive-ui'

defineOptions({
  name: 'MemoryInfoCard',
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

const memoryPercent = computed(() => clampPercent(props.info?.memory.usageRate ?? 0))
</script>

<template>
  <div v-if="mode === 'info'" class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      内存
    </div>
    <div>
      <div class="font-semibold">
        <NSkeleton v-if="loading" text animated :sharp="false" width="160px" />
        <template v-else>
          {{ info?.memory.usedGb ?? '--' }} / {{ info?.memory.totalGb ?? '--' }} GB
        </template>
      </div>
      <div class="text-xs text-muted-foreground mt-1">
        <NSkeleton v-if="loading" text animated :repeat="1" :sharp="false" width="96px" />
        <template v-else>
          使用率 {{ info?.memory.usageRate ?? '--' }}%
        </template>
      </div>
    </div>
  </div>
  <div v-if="mode === 'charts'" class="p-3 rounded-lg flex flex-col cursor-pointer items-center justify-center">
    <NProgress
      type="circle"
      :percentage="memoryPercent"
      :height="110"
      :stroke-width="8"
      :offset-degree="180"
      :show-indicator="true"
    >
      <n-space vertical align="center" :size="0">
        <span class="text-lg text-muted-foreground">
          {{ memoryPercent.toFixed(2) }}%
        </span>
        <span class="text-xs text-muted-foreground">
          内存
        </span>
      </n-space>
    </NProgress>
    <span class="text-xs text-muted-foreground mt-4">{{ info?.memory.usedGb ?? '--' }} / {{ info?.memory.totalGb ?? '--' }} GB</span>
  </div>
</template>
