<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NPopover, NProgress, NSkeleton, NSpace } from 'naive-ui'

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
const memoryGuidance = computed(() => props.info?.memoryGuidance ?? null)
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
  <NPopover
    v-if="mode === 'charts'"
    trigger="hover"
    placement="top"
    :disabled="!memoryGuidance"
  >
    <template #trigger>
      <div
        class="p-3 rounded-lg flex flex-col items-center justify-center"
        :class="memoryGuidance ? 'cursor-help' : ''"
      >
        <NProgress
          type="circle"
          :percentage="memoryPercent"
          :height="110"
          :stroke-width="8"
          :offset-degree="180"
          :show-indicator="true"
        >
          <NSpace vertical align="center" :size="0">
            <span class="text-lg text-muted-foreground">
              {{ memoryPercent.toFixed(2) }}%
            </span>
            <span class="text-xs text-muted-foreground">
              内存
            </span>
          </NSpace>
        </NProgress>
        <span class="text-xs text-muted-foreground mt-4">{{ info?.memory.usedGb ?? '--' }} / {{ info?.memory.totalGb ?? '--' }} GB</span>
      </div>
    </template>
    <div v-if="memoryGuidance" class="max-w-xs text-sm leading-relaxed">
      <p class="font-medium">
        内存档位：{{ memoryGuidance.tierLabelZh }}
      </p>
      <p class="text-muted-foreground mt-1">
        {{ memoryGuidance.summaryZh }}
      </p>
    </div>
  </NPopover>
</template>
