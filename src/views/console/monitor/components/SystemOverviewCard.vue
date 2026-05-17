<script setup lang="ts">
import type { SystemInfoData } from './types'
import { NSkeleton } from 'naive-ui'

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
      <NSkeleton v-if="loading" text animated :sharp="false" width="220px" />
      <template v-else>
        {{ info?.os.platform ?? '--' }} {{ info?.os.release ?? '--' }} ({{ info?.os.arch ?? '--' }})
      </template>
    </div>
    <div class="text-xs text-muted-foreground mt-1">
      <NSkeleton v-if="loading" text animated :repeat="1" :sharp="false" width="260px" />
      <template v-else>
        主机名 {{ info?.os.hostname ?? '--' }} · 面板版本 {{ info?.panelVersion ?? '--' }}
      </template>
    </div>
  </div>
</template>
