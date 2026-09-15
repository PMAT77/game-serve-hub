<script setup lang="ts">
import { NTooltip } from 'naive-ui'

defineOptions({ name: 'ConfigActionBar' })

withDefaults(defineProps<{
  dirty?: boolean
  /** 任一操作进行中：三个按钮一律置灰，避免并发提交 */
  busy?: boolean
  /** 「保存」按钮自身的 loading */
  saving?: boolean
  /** 「保存并重启」按钮自身的 loading */
  restarting?: boolean
  /** 「重置」按钮自身的 loading */
  resetting?: boolean
  restartDisabled?: boolean
  /** 「保存并重启」禁用原因（禁用时以 tooltip 展示） */
  restartDisabledTitle?: string
  /** 不需要重启动作的页面（如系统设置）可隐藏 */
  showRestart?: boolean
  saveLabel?: string
  restartLabel?: string
}>(), {
  showRestart: true,
  saveLabel: '保存配置',
  restartLabel: '保存并重启',
})

const emit = defineEmits<{
  reset: []
  save: []
  saveAndRestart: []
}>()
</script>

<template>
  <FaFixedBar position="bottom">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted-foreground">
        {{ dirty ? '存在未保存的修改' : '所有修改已保存' }}
      </span>
      <div class="flex flex-wrap gap-2">
        <FaButton variant="outline" :loading="resetting" :disabled="!dirty || busy" @click="emit('reset')">
          重置
        </FaButton>
        <FaButton :loading="saving" :disabled="!dirty || busy" @click="emit('save')">
          {{ saveLabel }}
        </FaButton>
        <NTooltip v-if="showRestart" :disabled="!restartDisabled || !restartDisabledTitle">
          <template #trigger>
            <FaButton :loading="restarting" :disabled="!dirty || busy || restartDisabled" @click="emit('saveAndRestart')">
              {{ restartLabel }}
            </FaButton>
          </template>
          {{ restartDisabledTitle }}
        </NTooltip>
      </div>
    </div>
  </FaFixedBar>
</template>
