<script setup lang="ts">
defineOptions({ name: 'ConfigActionBar' })

withDefaults(defineProps<{
  dirty?: boolean
  saving?: boolean
  restartDisabled?: boolean
  saveLabel?: string
  restartLabel?: string
}>(), {
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
        <FaButton variant="outline" :disabled="!dirty || saving" @click="emit('reset')">
          重置
        </FaButton>
        <FaButton :loading="saving" :disabled="!dirty || saving" @click="emit('save')">
          {{ saveLabel }}
        </FaButton>
        <FaButton :loading="saving" :disabled="!dirty || saving || restartDisabled" @click="emit('saveAndRestart')">
          {{ restartLabel }}
        </FaButton>
      </div>
    </div>
  </FaFixedBar>
</template>
