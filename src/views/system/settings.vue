<script setup lang="ts">
import type { PanelSettingsPayload } from '@/api/modules/system'
import apiSystem from '@/api/modules/system'

defineOptions({
  name: 'SystemSettings',
})

const loading = ref(false)
const saveLoading = ref(false)
const updateStatusLoading = ref(false)
const applyLoading = ref(false)
const updateStatus = ref<Awaited<ReturnType<typeof apiSystem.getPanelUpdateStatus>>['data'] | null>(null)

const form = reactive<PanelSettingsPayload>({
  panelPort: 80,
  theme: 'system',
  autoUpdate: true,
  checkUpdateBeforeStart: false,
  updateCheckIntervalHours: 3,
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

const updateIntervalInput = computed({
  get: () => String(form.updateCheckIntervalHours),
  set: (value: string) => {
    const nextHours = Number.parseInt(value, 10)
    if (Number.isNaN(nextHours)) {
      return
    }
    form.updateCheckIntervalHours = nextHours
  },
})

const hasHubUpdate = computed(() => {
  if (!updateStatus.value) {
    return false
  }
  return updateStatus.value.panel.updateAvailable || updateStatus.value.dst.updateAvailable
})

const canApplyUpdate = computed(() => {
  if (!updateStatus.value || updateStatus.value.updating) {
    return false
  }
  return hasHubUpdate.value && updateStatus.value.applySupported
})

function formatImageLine(
  label: string,
  info: NonNullable<typeof updateStatus.value>['panel'],
) {
  const version = info.releaseVersion || info.tag
  const digest = info.localDigestShort ? ` · ${info.localDigestShort}` : ''
  const status = info.updateAvailable ? '（有新版本）' : '（已是最新）'
  return `${label}：${version}${digest}${status}`
}

async function loadSettings() {
  loading.value = true
  try {
    const res = await apiSystem.getSettings()
    form.panelPort = res.data.panelPort
    form.theme = res.data.theme
    form.autoUpdate = res.data.autoUpdate
    form.checkUpdateBeforeStart = res.data.checkUpdateBeforeStart ?? false
    form.updateCheckIntervalHours = res.data.updateCheckIntervalHours ?? 3
  }
  finally {
    loading.value = false
  }
}

async function loadUpdateStatus() {
  try {
    const res = await apiSystem.getPanelUpdateStatus()
    updateStatus.value = res.data
  }
  catch {
    updateStatus.value = null
  }
}

async function checkHubUpdate() {
  updateStatusLoading.value = true
  try {
    const res = await apiSystem.checkPanelUpdate()
    updateStatus.value = res.data
    if (res.data.panel.updateAvailable || res.data.dst.updateAvailable) {
      faToast.info('检测到 Hub 镜像有新版本')
    }
    else {
      faToast.success('Hub 镜像已是最新版本')
    }
  }
  finally {
    updateStatusLoading.value = false
  }
}

async function applyHubUpdate() {
  if (!canApplyUpdate.value) {
    return
  }
  applyLoading.value = true
  try {
    const res = await apiSystem.applyPanelUpdate()
    faToast.success(res.data.message)
    if (res.data.status === 'updating') {
      updateStatus.value = updateStatus.value
        ? { ...updateStatus.value, updating: true }
        : updateStatus.value
    }
    else {
      await loadUpdateStatus()
    }
  }
  finally {
    applyLoading.value = false
  }
}

async function saveSettings() {
  if (!Number.isInteger(form.panelPort) || form.panelPort <= 0 || form.panelPort > 65535) {
    faToast.warning('端口范围应为 1-65535')
    return
  }
  if (!Number.isInteger(form.updateCheckIntervalHours) || form.updateCheckIntervalHours < 1 || form.updateCheckIntervalHours > 168) {
    faToast.warning('更新检查间隔应为 1-168 小时')
    return
  }
  saveLoading.value = true
  try {
    await apiSystem.saveSettings({
      panelPort: form.panelPort,
      theme: form.theme,
      autoUpdate: form.autoUpdate,
      checkUpdateBeforeStart: form.checkUpdateBeforeStart,
      updateCheckIntervalHours: form.updateCheckIntervalHours,
    })
    faToast.success('系统设置已保存')
  }
  finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadUpdateStatus()])
})
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
          Hub 版本
        </h3>
        <div v-if="updateStatus" class="space-y-2 text-sm">
          <p>{{ formatImageLine('面板镜像', updateStatus.panel) }}</p>
          <p>{{ formatImageLine('DST 运行镜像', updateStatus.dst) }}</p>
          <p v-if="updateStatus.release" class="text-muted-foreground">
            最新 Release：{{ updateStatus.release.tagName }}
            <span v-if="updateStatus.lastCheckedAt"> · 上次检查 {{ updateStatus.lastCheckedAt }}</span>
          </p>
          <p v-else-if="updateStatus.lastCheckedAt" class="text-xs text-muted-foreground">
            上次检查：{{ updateStatus.lastCheckedAt }}
          </p>
          <p v-if="updateStatus.checkError" class="text-xs text-amber-600 dark:text-amber-400">
            检查提示：{{ updateStatus.checkError }}
          </p>
          <p v-if="updateStatus.applyHint" class="text-xs text-muted-foreground">
            {{ updateStatus.applyHint }}
          </p>
          <pre
            v-if="updateStatus.manualUpdateCommand && !updateStatus.applySupported"
            class="text-xs bg-muted overflow-x-auto p-3 rounded-md"
          >{{ updateStatus.manualUpdateCommand }}</pre>
          <div
            v-if="updateStatus.release?.body"
            class="text-xs text-muted-foreground whitespace-pre-wrap border rounded-md p-3 max-h-40 overflow-y-auto"
          >
            {{ updateStatus.release.body }}
          </div>
        </div>
        <div v-else class="text-sm text-muted-foreground">
          暂无法读取 Hub 版本信息
        </div>
        <div class="flex flex-wrap gap-2 pt-1">
          <FaButton variant="outline" :loading="updateStatusLoading" @click="checkHubUpdate">
            检查更新
          </FaButton>
          <FaButton
            :loading="applyLoading"
            :disabled="!canApplyUpdate"
            @click="applyHubUpdate"
          >
            立即更新
          </FaButton>
        </div>
        <p class="text-xs text-muted-foreground">
          仅会更新检测到新版本的镜像。面板更新会导致服务短暂中断（约 30 秒）；DST 运行镜像更新后，需重启实例才生效。
        </p>
      </section>

      <section class="space-y-3">
        <h3 class="text-base font-semibold">
          Hub 镜像自动检查
        </h3>
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.autoUpdate" />
          <span class="text-sm text-muted-foreground">
            {{ form.autoUpdate ? '已启用 Hub 镜像自动检查' : '已关闭 Hub 镜像自动检查' }}
          </span>
        </div>
        <div class="space-y-2 max-w-80">
          <label class="text-sm text-muted-foreground">检查间隔（小时）</label>
          <FaInput v-model="updateIntervalInput" type="text" placeholder="1-168" />
        </div>
      </section>

      <section class="space-y-3">
        <h3 class="text-base font-semibold">
          启动前检查游戏更新
        </h3>
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.checkUpdateBeforeStart" />
          <span class="text-sm text-muted-foreground">
            {{ form.checkUpdateBeforeStart ? '启动前将向 Steam 检查 Build ID，有新版时将阻止启动' : '启动时不额外检查 Steam 远端版本' }}
          </span>
        </div>
        <p class="text-xs text-muted-foreground">
          开启后，点击「启动」或「重启」会先拉取 Steam 最新 Build ID；若与本地不一致，需先在实例页执行「更新服务端」。
        </p>
      </section>

      <div class="pt-2">
        <FaButton :loading="saveLoading" @click="saveSettings">
          保存设置
        </FaButton>
      </div>
    </div>
  </FaPageMain>
</template>
