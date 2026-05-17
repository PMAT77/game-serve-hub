<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NSkeleton } from 'naive-ui'

defineOptions({
  name: 'DockerInfoCard',
})

const props = defineProps<{
  loading: boolean
  info: SystemInfoData | null
}>()

const statusClass = computed(() => props.info?.dockerStatus === 'running' ? 'text-emerald-600' : 'text-amber-600')
</script>

<template>
  <div class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      Docker 状态
    </div>
    <div class="font-semibold" :class="statusClass">
      <NSkeleton v-if="loading" text animated :sharp="false" width="72px" />
      <template v-else>
        {{ info?.dockerStatus === 'running' ? '运行中' : '未运行' }}
      </template>
    </div>
  </div>
</template>
