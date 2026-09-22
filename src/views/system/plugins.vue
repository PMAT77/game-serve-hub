<script setup lang="ts">
import PluginsSection from './PluginsSection.vue'

defineOptions({
  name: 'SystemPlugins',
})
</script>

<template>
  <FaPageMain title="插件" class="h-full">
    <PluginsSection />
  </FaPageMain>
</template>
