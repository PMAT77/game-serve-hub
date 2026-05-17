<script setup lang="ts">
import HeroGeometric from './HeroGeometric.vue'
import type { AppHelloProps } from './types'

defineOptions({
  name: 'AppHello',
})

const props = withDefaults(defineProps<AppHelloProps>(), {
  title: 'Game Server Hub',
  subtitle: 'Instant Deploy',
  description: '一站式游戏服务器部署与管理平台',
})
</script>

<template>
  <HeroGeometric
    class="h-full w-full"
    :badge="props.badge"
    :title="props.title"
    :subtitle="props.subtitle"
    :description="props.description"
    :compact="props.compact"
  />
</template>
