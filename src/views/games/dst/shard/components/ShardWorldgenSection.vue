<script setup lang="ts">
import type { CavesWorldgenPreset, MasterWorldgenPreset } from '@/api/modules/shard'
import { NTag } from 'naive-ui'
import { getWorldgenOptions } from '../constants/dstWorldAssets'
import ShardWorldRulesSection from './ShardWorldRulesSection.vue'

const props = defineProps<{
  shard: 'master' | 'caves'
  shardFolder: 'Master' | 'Caves'
  modelValue: MasterWorldgenPreset | CavesWorldgenPreset
  worldgenConfig: Record<string, string>
  worldGenerated?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: MasterWorldgenPreset | CavesWorldgenPreset]
  'update:worldgenConfig': [value: Record<string, string>]
}>()

const worldgenLocked = computed(() => Boolean(props.worldGenerated))

const isMaster = computed(() => props.shard === 'master')

const presetOptions = computed(() => getWorldgenOptions(props.shard))

function selectPreset(preset: CavesWorldgenPreset) {
  if (worldgenLocked.value || isMaster.value) {
    return
  }
  emit('update:modelValue', preset)
}

const worldgenConfigModel = computed({
  get: () => props.worldgenConfig,
  set: (value: Record<string, string>) => {
    emit('update:worldgenConfig', { ...value })
  },
})
</script>

<template>
  <div class="space-y-6">

    <!-- 世界生成预设：地上固定联机生存，洞穴可选；世界生成后锁定 -->
    <section class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-medium text-foreground">
          地图预设
        </h3>
        <NTag v-if="worldgenLocked" size="small" :bordered="false" type="warning">
          世界已生成，预设已锁定
        </NTag>
      </div>

      <p v-if="isMaster" class="text-sm text-muted-foreground">
        地上世界使用官方「联机生存」预设，无需选择；可调整下方世界生成参数。
      </p>
      <div v-else class="grid gap-3 sm:grid-cols-3">
        <button
          v-for="option in presetOptions"
          :key="option.id"
          type="button"
          :disabled="worldgenLocked"
          class="flex items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          :class="modelValue === option.preset
            ? 'border-primary ring-2 ring-primary/40'
            : 'border-border hover:border-primary/50'"
          @click="selectPreset(option.preset as CavesWorldgenPreset)"
        >
          <span class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/30">
            <img :src="option.image" :alt="option.label" class="max-h-full max-w-full object-contain" loading="lazy">
          </span>
          <span class="text-sm font-medium">{{ option.label }}</span>
        </button>
      </div>

      <p v-if="worldgenLocked" class="text-xs text-muted-foreground">
        世界已按当前预设生成，预设与生成参数不再修改；如需更换，请备份存档后重建实例。
      </p>
    </section>

    <ShardWorldRulesSection
      v-model="worldgenConfigModel"
      :shard="shard"
      :shard-folder="shardFolder"
      config-tab="worldgen"
      :disabled="worldgenLocked"
    />
  </div>
</template>
