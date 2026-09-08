<script setup lang="ts">
import type { SystemInfoData } from './types'

defineOptions({
  name: 'SystemOverviewCard',
})

defineProps<{
  loading: boolean
  info: SystemInfoData | null
}>()
</script>

<template>
  <div class="p-3 border rounded-lg">
    <div class="text-xs text-muted-foreground mb-2">
      系统
    </div>
    <div class="font-semibold">
      {{ info?.os.platform ?? '--' }} {{ info?.os.release ?? '--' }} ({{ info?.os.arch ?? '--' }})
    </div>
    <div class="text-xs text-muted-foreground mt-1">
      主机名 {{ info?.os.hostname ?? '--' }} · 面板版本 {{ info?.panelVersion ?? '--' }}
    </div>
  </div>
</template>
