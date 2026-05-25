<script setup lang="ts">
import { APP_TITLE } from '@/utils/app-title'

defineOptions({
  name: 'Logo',
})

withDefaults(
  defineProps<{
    showLogo?: boolean
    showTitle?: boolean
  }>(),
  {
    showLogo: true,
    showTitle: true,
  },
)

const appSettingsStore = useAppSettingsStore()

const title = ref(APP_TITLE)

const to = computed(() => appSettingsStore.settings.app.home.enable ? appSettingsStore.settings.app.home.fullPath : '')
</script>

<template>
  <RouterLink :to class="text-primary px-3 no-underline flex-center gap-2 h-[var(--g-sidebar-logo-height)] w-inherit" :class="{ 'cursor-default': !appSettingsStore.settings.app.home.enable }" :title="title">
    <AppLogoMark v-if="showLogo" class="logo" />
    <span v-if="showTitle" class="font-bold block truncate">{{ title }}</span>
  </RouterLink>
</template>
