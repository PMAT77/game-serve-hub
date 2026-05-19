<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NProgress, NSkeleton } from 'naive-ui'

defineOptions({
  name: 'DockerInfoCard',
})

const props = withDefaults(defineProps<{
  loading: boolean
  info: SystemInfoData | null
  mode?: 'info' | 'charts'
}>(), {
  mode: 'info',
})

const isRunning = computed(() => props.info?.dockerStatus === 'running')
const statusPercent = computed(() => (isRunning.value ? 100 : 0))
const statusColor = computed(() => (isRunning.value ? '#10b981' : '#f59e0b'))
const statusText = computed(() => (isRunning.value ? '运行中' : '未运行'))
const statusClass = computed(() => (isRunning.value ? 'text-emerald-600' : 'text-amber-600'))
</script>

<template>
  <div v-if="mode === 'info'" class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      Docker 状态
    </div>
    <div class="font-semibold" :class="statusClass">
      <NSkeleton v-if="loading" text animated :sharp="false" width="72px" />
      <template v-else>
        {{ statusText }}
      </template>
    </div>
  </div>

  <div v-if="mode === 'charts'" class="p-3 rounded-lg flex flex-col cursor-pointer items-center justify-center">
    <NProgress
      type="circle"
      :percentage="statusPercent"
      :color="statusColor"
      :height="110"
      :stroke-width="8"
      :offset-degree="180"
      :show-indicator="true"
    >
      <n-space vertical align="center">
        <span class="text-lg text-muted-foreground">
          {{ loading ? '--' : statusText }}
        </span>
        <span class="text-xs text-muted-foreground">
          Docker
        </span>
      </n-space>
    </NProgress>
    <span class="text-xs text-muted-foreground mt-4">容器运行时</span>
  </div>
</template>
