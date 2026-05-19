<script setup lang="ts">
import type { SystemInfoData } from './types'
import DockerInfoCard from './DockerInfoCard.vue'
import SystemLoadCard from './SystemLoadCard.vue'
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
    <SystemOverviewCard :loading="loading" :info="info" />
    <div class="gap-3 grid grid-cols-1 md:grid-cols-2">
      <SystemLoadCard :loading="loading" :info="info" />
      <DockerInfoCard :loading="loading" :info="info" />
    </div>
  </div>
</template>
