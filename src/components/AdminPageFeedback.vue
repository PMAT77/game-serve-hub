<script setup lang="ts">
import { NAlert, NButton, NCollapse, NCollapseItem, NEmpty, NSkeleton, NSpace } from 'naive-ui'

defineOptions({
  name: 'AdminPageFeedback',
})

/**
 * 管理页统一三态反馈（loading / error / empty）。
 *
 * 使用规范：
 * - 空态必须提供 emptyDescription + emptyActionLabel（给用户下一步动作，不允许「暂无数据」裸奔）；
 * - 错误态透出的 errorMessage 应为用户可读文案，技术细节放 errorDetail（默认折叠）；
 * - 空态文案示例：「暂无实例」+「创建第一个实例」；错误态示例：「加载失败」+「重试」。
 */
withDefaults(defineProps<{
  showSkeleton?: boolean
  skeletonRows?: number
  showError?: boolean
  errorMessage?: string | null
  /** 可选的技术性错误详情，折叠展示（原始报错、requestId 等） */
  errorDetail?: string | null
  showEmpty?: boolean
  emptyDescription?: string
  emptyActionLabel?: string
}>(), {
  skeletonRows: 6,
  emptyDescription: '暂无数据',
})

const emit = defineEmits<{
  retry: []
  emptyAction: []
}>()
</script>

<template>
  <div v-if="showSkeleton" class="space-y-3" aria-busy="true" aria-label="加载中">
    <NSkeleton v-for="i in skeletonRows" :key="i" text :style="{ width: i === skeletonRows ? '60%' : '100%' }" />
  </div>
  <div v-else-if="showError" class="space-y-3" role="alert">
    <NAlert type="error" :title="errorMessage || '加载失败'">
      <template v-if="errorDetail" #default>
        <NCollapse size="small" display-directive="show">
          <NCollapseItem title="错误详情">
            <p class="text-xs whitespace-pre-wrap break-all text-muted-foreground">
              {{ errorDetail }}
            </p>
          </NCollapseItem>
        </NCollapse>
      </template>
    </NAlert>
    <NButton size="small" @click="emit('retry')">
      重试
    </NButton>
  </div>
  <NEmpty
    v-else-if="showEmpty"
    :description="emptyDescription"
  >
    <template v-if="emptyActionLabel" #extra>
      <NSpace justify="center">
        <NButton type="primary" @click="emit('emptyAction')">
          {{ emptyActionLabel }}
        </NButton>
      </NSpace>
    </template>
  </NEmpty>
  <slot v-else />
</template>
