<script setup lang="ts">
import type { SystemInfoData } from './types'
import CpuInfoCard from './CpuInfoCard.vue'
import DiskInfoCard from './DiskInfoCard.vue'
import MemoryInfoCard from './MemoryInfoCard.vue'
import SystemLoadCard from './SystemLoadCard.vue'

defineOptions({
  name: 'MonitorStatus',
})

defineProps<{
  loading: boolean
  info: SystemInfoData | null
}>()
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-4">
      <div class="gap-3 grid grid-cols-1 md-grid-cols-4">
        <SystemLoadCard :loading="loading" :info="info" mode="charts" />
        <CpuInfoCard :loading="loading" :info="info" mode="charts" />
        <MemoryInfoCard :loading="loading" :info="info" mode="charts" />
        <DiskInfoCard :loading="loading" :info="info" mode="charts" />
      </div>
    </div>
  </div>
</template>
