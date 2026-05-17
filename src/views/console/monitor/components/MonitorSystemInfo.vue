<script setup lang="ts">
import type { SystemInfoData } from './types'
import CpuInfoCard from './CpuInfoCard.vue'
import DiskInfoCard from './DiskInfoCard.vue'
import DockerInfoCard from './DockerInfoCard.vue'
import MemoryInfoCard from './MemoryInfoCard.vue'
import SystemOverviewCard from './SystemOverviewCard.vue'

defineOptions({
  name: 'MonitorSystemInfo',
})

defineProps<{
  loading: boolean
  info: SystemInfoData | null
}>()
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-4">
      <SystemOverviewCard :loading="loading" :info="info" />
      <div class="gap-3 grid grid-cols-1 md-grid-cols-2">
        <CpuInfoCard :loading="loading" :info="info" />
        <MemoryInfoCard :loading="loading" :info="info" />
      </div>
      <div class="gap-3 grid grid-cols-1 md-grid-cols-2">
        <DiskInfoCard :loading="loading" :info="info" />
        <DockerInfoCard :loading="loading" :info="info" />
      </div>
    </div>
  </div>
</template>
