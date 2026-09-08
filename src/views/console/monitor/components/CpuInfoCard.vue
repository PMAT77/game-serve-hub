<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NProgress } from 'naive-ui'

defineOptions({
  name: 'CpuInfoCard',
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

const cpuPercent = computed(() => clampPercent(props.info?.cpu.usageRate ?? 0))
</script>

<template>
  <div v-if="mode === 'info'" class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      CPU
    </div>

    <div>
      <div class="font-semibold">
        {{ info?.cpu.cores ?? '--' }} 核
      </div>
      <div class="text-xs text-muted-foreground mt-1">
        {{ info?.cpu.model ?? '--' }}
      </div>
    </div>
  </div>

  <div v-if="mode === 'charts'" class="p-3 rounded-lg flex flex-col cursor-pointer items-center justify-center">
    <NProgress
      type="circle"
      :percentage="cpuPercent"
      :height="110"
      :stroke-width="8"
      :offset-degree="180"
      :show-indicator="true"
    >
      <n-space vertical align="center">
        <span class="text-lg text-muted-foreground">
          {{ cpuPercent.toFixed(2) }}%
        </span>
        <span class="text-xs text-muted-foreground">
          CPU
        </span>
      </n-space>
    </NProgress>
    <span class="text-xs text-muted-foreground mt-4">{{ info?.cpu.cores ?? '--' }} 核</span>
  </div>
</template>
