<script setup lang="ts">
import EditPassword from '@/components/AppAccountForm/edit-password.vue'
import { ensureDynamicRoutes } from '@/router/ensure-dynamic-routes'

defineOptions({
  name: 'ForceChangePassword',
})

const router = useRouter()
const appSettingsStore = useAppSettingsStore()

async function handlePasswordChanged() {
  try {
    await ensureDynamicRoutes(router)
  }
  catch {
    faToast.error('无法进入系统', {
      description: '菜单与路由加载失败，请刷新后重试',
    })
    return
  }
  await router.replace(appSettingsStore.settings.app.home.fullPath)
}
</script>

<template>
  <div class="bg-background flex-col-center min-h-screen w-full">
    <div class="p-8 w-full max-w-lg">
      <div class="mb-6 p-4 border border-amber-500/30 rounded-lg bg-amber-500/10 space-y-2">
        <p class="text-sm font-medium">
          首次登录须修改初始密码
        </p>
        <p class="text-xs text-muted-foreground">
          安装脚本已启用强制改密（FORCE_PASSWORD_CHANGE）。请设置符合强度要求的新密码后再进入面板。
        </p>
      </div>
      <EditPassword force-mode @on-success="handlePasswordChanged" />
    </div>
  </div>
</template>
