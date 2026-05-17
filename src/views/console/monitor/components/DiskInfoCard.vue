<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NProgress, NSkeleton } from 'naive-ui'

defineOptions({
  name: 'DiskInfoCard',
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

const diskPercent = computed(() => {
  if (!props.info || props.info.disk.totalGb <= 0) {
    return 0
  }
  return clampPercent((props.info.disk.usedGb / props.info.disk.totalGb) * 100)
})
</script>

<template>
  <div v-if="mode === 'info'" class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      磁盘
    </div>
    <div>
      <div class="font-semibold">
        <NSkeleton v-if="loading" text animated :sharp="false" width="180px" />
        <template v-else>
          {{ info?.disk.usedGb ?? '--' }} / {{ info?.disk.totalGb ?? '--' }} GB
        </template>
      </div>
      <div class="text-xs text-muted-foreground mt-1">
        <NSkeleton v-if="loading" text animated :repeat="1" :sharp="false" width="120px" />
        <template v-else>
          可用 {{ info?.disk.freeGb ?? '--' }} GB
        </template>
      </div>
    </div>
  </div>
  <div v-if="mode === 'charts'" class="p-3 rounded-lg flex flex-col cursor-pointer items-center justify-center">
    <NProgress
      type="circle"
      :percentage="diskPercent"
      :height="110"
      :stroke-width="8"
      :offset-degree="180"
      :show-indicator="true"
    >
      <n-space vertical align="center">
        <span class="text-lg text-muted-foreground">
          {{ diskPercent.toFixed(2) }}%
        </span>
        <span class="text-xs text-muted-foreground">
          磁盘
        </span>
      </n-space>
    </NProgress>
    <span class="text-xs text-muted-foreground mt-4">{{ info?.disk.usedGb ?? '--' }} / {{ info?.disk.totalGb ?? '--' }} GB</span>
  </div>
</template>
