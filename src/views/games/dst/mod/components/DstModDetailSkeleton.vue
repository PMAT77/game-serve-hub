<script setup lang="ts">
import { NCard, NSkeleton } from 'naive-ui'

defineOptions({
  name: 'DstModDetailSkeleton',
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true" aria-label="加载中">
    <NCard size="small" class="shrink-0">
      <NSkeleton text width="120px" class="mb-4" />
      <div class="flex flex-col gap-4 lg:flex-row">
        <NSkeleton height="160px" width="160px" class="shrink-0 rounded" />
        <div class="min-w-0 flex-1 space-y-3">
          <NSkeleton text :repeat="7" />
        </div>
      </div>
    </NCard>

    <NCard size="small" class="flex min-h-0 flex-1 flex-col">
      <NSkeleton text width="80px" class="mb-4 shrink-0" />
      <div class="min-h-0 flex-1 space-y-2">
        <NSkeleton text :repeat="6" />
        <NSkeleton text width="70%" />
      </div>
    </NCard>

    <div class="flex shrink-0 justify-center gap-2">
      <NSkeleton height="34px" width="96px" :sharp="false" />
      <NSkeleton height="34px" width="120px" :sharp="false" />
    </div>
  </div>
</template>
