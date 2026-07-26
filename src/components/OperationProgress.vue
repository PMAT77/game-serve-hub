<script setup lang="ts">
import { NAlert, NSpin } from 'naive-ui'

defineOptions({ name: 'OperationProgress' })

const props = defineProps<{
  phase?: string | null
  percent?: number | null
  error?: string | null
}>()

const normalizedPercent = computed(() => props.percent == null ? null : Math.min(100, Math.max(0, props.percent)))
</script>

<template>
  <NAlert v-if="error" type="error" :title="error" />
  <div v-else class="space-y-2" aria-live="polite">
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <NSpin v-if="normalizedPercent == null" size="small" />
      <span>{{ phase || '处理中，请稍候' }}</span>
      <span v-if="normalizedPercent != null" class="ml-auto">{{ normalizedPercent }}%</span>
    </div>
    <FaProgress v-if="normalizedPercent != null" :model-value="normalizedPercent" class="h-2" />
  </div>
</template>
