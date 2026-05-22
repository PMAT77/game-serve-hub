<script setup lang="ts">
import { NSelect, NTag } from 'naive-ui'
import { getWorldRuleOptionsForShard } from '../constants/dstWorldAssets'
import {
  buildWorldConfigRows,
  groupWorldConfigRows,
  resolveRowLevelProfile,
  type DstWorldConfigTab,
} from '../constants/dstWorldRuleCatalog'
import {
  normalizeLevelValue,
  toSelectOptions,
} from '../constants/dstWorldRuleLevels'

const props = defineProps<{
  shard: 'master' | 'caves'
  shardFolder: 'Master' | 'Caves'
  modelValue: Record<string, string>
  configTab?: DstWorldConfigTab
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

const activeTab = computed(() => props.configTab ?? 'rules')

const ruleSections = computed(() => {
  const rows = buildWorldConfigRows(
    props.shard,
    activeTab.value,
    getWorldRuleOptionsForShard(props.shard),
  )
  return groupWorldConfigRows(rows)
})

function ruleLevel(overrideKey: string): string {
  const row = ruleSections.value
    .flatMap(s => s.items)
    .find(item => item.overrideKey === overrideKey)
  if (!row) {
    return 'default'
  }
  const profile = resolveRowLevelProfile(row)
  return normalizeLevelValue(profile.levels, props.modelValue[overrideKey])
}

function setRuleLevel(overrideKey: string, level: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    [overrideKey]: level,
  })
} 
</script>

<template>
  <div class="space-y-6"> 
    <section
      v-for="section in ruleSections"
      :key="section.sectionId"
      class="space-y-3"
    >
      <h3 class="text-sm font-medium text-foreground">
        {{ section.title }}
      </h3>

      <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <div
          v-for="item in section.items"
          :key="item.overrideKey"
          class="flex items-stretch gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div
            class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/30 sm:size-[4.5rem]"
          >
            <img
              v-if="item.image"
              :src="item.image"
              :alt="item.labelZh"
              class="max-h-full max-w-full object-contain"
              loading="lazy"
            >
            <span
              v-else
              class="px-1 text-center text-[10px] leading-tight text-muted-foreground"
            >
              无图标
            </span>
          </div>

          <div class="flex min-w-0 flex-1 flex-col justify-between gap-2">
            <p class="flex justify-center items-center flex-grow text-center text-lg leading-snug font-medium text-foreground ">
              {{ item.labelZh }}
            </p>

            <NTag
              v-if="item.readOnly"
              size="small"
              :bordered="false"
              class="justify-center"
            >
              2 层（不可修改）
            </NTag>

            <NSelect
              v-else
              :value="ruleLevel(item.overrideKey)"
              :options="toSelectOptions(resolveRowLevelProfile(item).levels)"
              :disabled="disabled"
              @update:value="setRuleLevel(item.overrideKey, $event ?? ruleLevel(item.overrideKey))"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
