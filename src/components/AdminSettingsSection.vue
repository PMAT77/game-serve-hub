<script setup lang="ts">
defineOptions({
  name: 'AdminSettingsSection',
})

defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="space-y-3">
    <div>
      <h3 class="text-base font-semibold">
        {{ title }}
      </h3>
      <p v-if="description" class="mt-1 text-sm text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <slot />
  </section>
</template>
