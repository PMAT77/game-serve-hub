<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NProgress, NSpace } from 'naive-ui'
import { computed } from 'vue'

defineOptions({
  name: 'RuntimeInfoCard',
})

const props = withDefaults(defineProps<{
  loading: boolean
  info: SystemInfoData | null
  mode?: 'info' | 'charts'
}>(), {
  mode: 'info',
})

const runtimeMode = computed(() => props.info?.runtimeMode ?? 'docker')
const runtimeStatus = computed(() => props.info?.runtimeStatus ?? props.info?.dockerStatus ?? null)
const runtimeLabel = computed(() => runtimeMode.value === 'native' ? 'systemd' : 'Docker')
const runtimeDescription = computed(() => runtimeMode.value === 'native' ? '原生进程运行时' : '容器运行时')
const isRunning = computed(() => runtimeStatus.value === 'running')
/** 无数据（接口失败/未加载）时展示「未知」，不伪装成「未运行」 */
const hasData = computed(() => runtimeStatus.value !== null)
const statusPercent = computed(() => (isRunning.value ? 100 : 0))
const statusColor = computed(() => (isRunning.value ? '#10b981' : hasData.value ? '#f59e0b' : '#94a3b8'))
const statusText = computed(() => (isRunning.value ? '运行中' : hasData.value ? '未运行' : '未知'))
const statusClass = computed(() => (isRunning.value ? 'text-emerald-600' : hasData.value ? 'text-amber-600' : 'text-muted-foreground'))
</script>

<template>
  <div v-if="props.mode === 'info'" class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      {{ runtimeLabel }} 状态
    </div>
    <div class="font-semibold" :class="statusClass">
      {{ statusText }}
    </div>
  </div>

  <div v-if="props.mode === 'charts'" class="p-3 rounded-lg flex flex-col items-center justify-center">
    <NProgress
      type="circle"
      :percentage="statusPercent"
      :color="statusColor"
      :height="110"
      :stroke-width="8"
      :offset-degree="180"
      :show-indicator="true"
    >
      <NSpace vertical align="center">
        <span class="text-lg text-muted-foreground">
          {{ props.loading ? '--' : statusText }}
        </span>
        <span class="text-xs text-muted-foreground">
          {{ runtimeLabel }}
        </span>
      </NSpace>
    </NProgress>
    <span class="text-xs text-muted-foreground mt-4">{{ runtimeDescription }}</span>
  </div>
</template>
