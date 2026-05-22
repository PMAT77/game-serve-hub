<script setup lang="ts">
import type { DstWorldOption } from '../constants/dstWorldAssets'

const props = withDefaults(defineProps<{
  options: DstWorldOption[]
  modelValue: string | null
  disabled?: boolean
  columns?: number
}>(), {
  disabled: false,
  columns: 4,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

function isSelected(option: DstWorldOption): boolean {
  if (option.kind === 'worldgen' && option.preset) {
    return props.modelValue === option.preset
  }
  return props.modelValue === option.id
}

function select(option: DstWorldOption) {
  if (props.disabled) {
    return
  }
  const value = option.kind === 'worldgen' && option.preset ? option.preset : option.id
  if (option.kind === 'worldgen') {
    emit('update:modelValue', value)
    return
  }
  emit('update:modelValue', isSelected(option) ? null : value)
}
</script>

<template>
  <div
    class="grid gap-3"
    :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
  >
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="group flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors"
      :class="[
        isSelected(option)
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
          : 'border-border bg-card hover:border-primary/40 hover:bg-muted/50',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ]"
      :disabled="disabled"
      :title="option.label"
      @click="select(option)"
    >
      <div class="flex size-16 items-center justify-center overflow-hidden rounded-md bg-muted/30 sm:size-20">
        <img
          :src="option.image"
          :alt="option.label"
          class="max-h-full max-w-full object-contain"
          loading="lazy"
        >
      </div>
      <span class="line-clamp-2 w-full text-xs leading-tight text-foreground">
        {{ option.label }}
      </span>
    </button>
  </div>
</template>
