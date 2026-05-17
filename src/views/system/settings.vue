<script setup lang="ts">
import type { PanelSettingsPayload } from '@/api/modules/system'
import apiSystem from '@/api/modules/system'

defineOptions({
  name: 'SystemSettings',
})

const loading = ref(false)
const saveLoading = ref(false)
const form = reactive<PanelSettingsPayload>({
  panelPort: 80,
  theme: 'system',
  autoUpdate: true,
})

const panelPortInput = computed({
  get: () => String(form.panelPort),
  set: (value: string) => {
    const nextPort = Number.parseInt(value, 10)
    if (Number.isNaN(nextPort)) {
      return
    }
    form.panelPort = nextPort
  },
})

async function loadSettings() {
  loading.value = true
  try {
    const res = await apiSystem.getSettings()
    form.panelPort = res.data.panelPort
    form.theme = res.data.theme
    form.autoUpdate = res.data.autoUpdate
  }
  finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!Number.isInteger(form.panelPort) || form.panelPort <= 0 || form.panelPort > 65535) {
    faToast.warning('端口范围应为 1-65535')
    return
  }
  saveLoading.value = true
  try {
    await apiSystem.saveSettings({
      panelPort: form.panelPort,
      theme: form.theme,
      autoUpdate: form.autoUpdate,
    })
    faToast.success('系统设置已保存')
  }
  finally {
    saveLoading.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <FaPageMain title="系统设置" class="h-full">
    <div v-if="loading" class="text-muted-foreground flex-center h-48">
      读取配置中...
    </div>
    <div v-else class="space-y-6">
      <section class="space-y-3">
        <h3 class="text-base font-semibold">
          面板端口
        </h3>
        <FaInput v-model="panelPortInput" type="text" class="max-w-80" placeholder="请输入面板端口" />
        <p class="text-xs text-muted-foreground">
          端口范围 1-65535，保存后由网关编排模块统一生效。
        </p>
      </section>

      <section class="space-y-3">
        <h3 class="text-base font-semibold">
          自动更新
        </h3>
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.autoUpdate" />
          <span class="text-sm text-muted-foreground">
            {{ form.autoUpdate ? '已启用自动检查更新' : '已关闭自动检查更新' }}
          </span>
        </div>
      </section>

      <div class="pt-2">
        <FaButton :loading="saveLoading" @click="saveSettings">
          保存设置
        </FaButton>
      </div>
    </div>
  </FaPageMain>
</template>
