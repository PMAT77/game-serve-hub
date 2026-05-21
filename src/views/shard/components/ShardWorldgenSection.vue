<script setup lang="ts">
import type { CavesWorldgenPreset, MasterWorldgenPreset } from '@/api/modules/shard'
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

const worldgenConfigModel = computed({
  get: () => props.worldgenConfig,
  set: (value: Record<string, string>) => emit('update:worldgenConfig', value),
})
</script>

<template>
  <div class="space-y-6"> 

    <ShardWorldRulesSection
      v-model="worldgenConfigModel"
      :shard="shard"
      :shard-folder="shardFolder"
      config-tab="worldgen"
      :disabled="worldgenLocked"
    />
  </div>
</template>
