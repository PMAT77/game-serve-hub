<script setup lang="ts">
import type { PluginListItem } from '@/api/modules/system'
import { NAlert, NModal, NTag } from 'naive-ui'
import { computed } from 'vue'
import { buildPluginCard, capabilityLabel, isDangerousCapability } from '../pluginStorePresentation'

/**
 * 插件详情。
 *
 * 这里回答的是「这个插件到底会做什么」——能力清单是其中唯一不能被营销文案替代的部分：
 * 一个插件申请了 `backups:delete`（删备份）与只申请 `metrics:read`（读指标），
 * 对管理员的含义完全不同，所以危险能力单独标出并置顶说明来源。
 */
const props = defineProps<{
  item: PluginListItem | null
  show: boolean
}>()

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
}>()

const card = computed(() => (props.item ? buildPluginCard(props.item) : null))
const detail = computed(() => props.item?.store?.detail ?? props.item?.description ?? '这个插件没有提供详细说明。')
/** 未签名是必须显式说出来的事实：管理员要据此决定要不要让它跑 */
const sourceLabel = computed(() => {
  if (!props.item) {
    return ''
  }
  if (!props.item.signed) {
    return '未签名'
  }
  return `已签名：${props.item.publisher ?? '未知发布方'}`
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="max-w-2xl"
    :title="item?.name ?? '插件详情'"
    @update:show="emit('update:show', $event)"
  >
    <div v-if="item && card" class="space-y-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <NTag size="small" :bordered="false" :type="card.type">
          {{ card.label }}
        </NTag>
        <NTag v-if="item.kind === 'commercial'" size="small" :bordered="false">
          商业插件
        </NTag>
        <NTag size="small" :bordered="false">
          {{ sourceLabel }}
        </NTag>
        <span v-if="card.installed" class="text-xs text-muted-foreground">{{ item.id }} · {{ item.version }}</span>
      </div>

      <p class="text-muted-foreground">
        {{ detail }}
      </p>

      <div v-if="item.store" class="rounded-md border px-3 py-2 text-xs text-muted-foreground">
        {{ item.store.access.detail }}
      </div>

      <div>
        <div class="font-medium">
          申请的能力
        </div>
        <div v-if="item.capabilities.length === 0" class="mt-1 text-xs text-muted-foreground">
          不申请任何能力：它只能在自己的目录里读写文件。
        </div>
        <div v-else class="mt-1 flex flex-wrap gap-1">
          <NTag
            v-for="capability in item.capabilities"
            :key="capability"
            size="small"
            :bordered="false"
            :type="isDangerousCapability(capability) ? 'warning' : 'default'"
          >
            {{ capabilityLabel(capability) }}
          </NTag>
        </div>
      </div>

      <NAlert v-if="card.dangerHint" type="warning" :bordered="false">
        {{ card.dangerHint }}
      </NAlert>

      <NAlert v-if="item.message" type="info" :bordered="false">
        {{ item.message }}
      </NAlert>

      <div v-if="card.installed && item.directory" class="text-xs text-muted-foreground break-all">
        插件目录：{{ item.directory }}
      </div>
    </div>
  </NModal>
</template>
