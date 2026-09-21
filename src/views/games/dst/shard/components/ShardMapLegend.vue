<script setup lang="ts">
import type { MapLegendEntryDto } from '@/api/modules/map'
import { computed } from 'vue'
import {
  formatLandmarkCount,
  formatLegendRatio,
  legendShapeClass,
  splitLegend,
} from './shardMapPresentation'

/**
 * 地形图图例。
 *
 * 颜色与形状全部来自服务端（与画在 PNG 上的是同一份），组件只负责铺成列表——
 * 前端自己再写一份对应关系，迟早会出现"图例写着森林、图上画成沼泽"。
 *
 * 只列这张图上真实出现过的类别：服务端已经过滤过，这里不再加阈值。服务端还会把
 * **没收录配色的地块排到最前面**并带上「未收录」，所以这一栏一眼就能看出要不要补色板。
 */

const props = defineProps<{
  entries: MapLegendEntryDto[]
}>()

const groups = computed(() => splitLegend(props.entries))
</script>

<template>
  <div
    v-if="entries.length"
    class="max-h-[min(60vh,560px)] overflow-y-auto rounded-md border p-3 text-xs"
  >
    <div v-if="groups.terrain.length">
      <div class="mb-2 font-medium">
        地形
        <span class="ml-1 font-normal text-muted-foreground">按占比排序</span>
      </div>
      <ul class="space-y-1.5">
        <li
          v-for="item in groups.terrain"
          :key="item.key"
          class="flex items-center gap-2"
        >
          <span
            class="inline-block size-3 shrink-0 border border-black/10"
            :class="legendShapeClass(item.shape)"
            :style="{ backgroundColor: item.color }"
          />
          <span
            class="min-w-0 flex-1 truncate"
            :class="item.known ? '' : 'font-medium text-amber-600 dark:text-amber-400'"
            :title="item.label"
          >
            {{ item.label }}
          </span>
          <span class="shrink-0 tabular-nums text-muted-foreground">{{ formatLegendRatio(item.ratio) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="groups.landmarks.length" class="mt-4 border-t pt-3">
      <div class="mb-2 font-medium">
        地标
        <span class="ml-1 font-normal text-muted-foreground">图上按形状分</span>
      </div>
      <ul class="space-y-1.5">
        <li
          v-for="item in groups.landmarks"
          :key="item.key"
          class="flex items-center gap-2"
        >
          <span
            class="inline-block size-3 shrink-0 border border-black/10"
            :class="legendShapeClass(item.shape)"
            :style="{ backgroundColor: item.color }"
          />
          <span class="min-w-0 flex-1 truncate" :title="item.label">{{ item.label }}</span>
          <span class="shrink-0 tabular-nums text-muted-foreground">{{ formatLandmarkCount(item.count) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
