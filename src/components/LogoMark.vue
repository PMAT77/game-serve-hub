<script setup lang="ts">
import logoSvg from '@/assets/images/logo.svg?raw'

withDefaults(
  defineProps<{
    /** Tailwind 尺寸类，如 `h-[30px] w-[35px]` */
    sizeClass?: string
  }>(),
  {
    sizeClass: 'h-[30px] w-[35px]',
  },
)
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full [&_svg]:object-contain"
    :class="sizeClass"
    aria-hidden="true"
    v-html="logoSvg"
  />
</template>
