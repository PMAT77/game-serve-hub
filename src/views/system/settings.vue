<script setup lang="ts">
import type { PanelSettingsPayload } from '@/api/modules/system'
import { NAlert, NCollapse, NCollapseItem, NInputNumber, NSelect, NSpin, useDialog } from 'naive-ui'
import AdminSettingsSection from '@/components/AdminSettingsSection.vue'
import ConfigActionBar from '@/components/ConfigActionBar.vue'
import apiSystem from '@/api/modules/system'
import { copyTextToClipboard } from '@/utils/copyToClipboard'
import { buildPanelUpdatePresentation, MANUAL_UPDATE_COMMAND, MANUAL_UPDATE_HINT, MANUAL_UPDATE_NOTE } from './panelUpdatePresentation'

defineOptions({
  name: 'SystemSettings',
})

const loading = ref(false)
const dialog = useDialog()
const appSettingsStore = useAppSettingsStore()
const settingsLoaded = ref(false)
const settingsLoadError = ref<string | null>(null)
const saveLoading = ref(false)
const updateStatusLoading = ref(false)
const applyLoading = ref(false)
const updateStatus = ref<Awaited<ReturnType<typeof apiSystem.getPanelUpdateStatus>>['data'] | null>(null)

function resolveBrowserAccessPort(): number {
  if (typeof window === 'undefined') {
    return 80
  }
  if (window.location.port) {
    const parsed = Number.parseInt(window.location.port, 10)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return window.location.protocol === 'https:' ? 443 : 80
}

const browserAccessPort = computed(() => resolveBrowserAccessPort())

const form = reactive<PanelSettingsPayload>({
  panelPort: 9527,
  theme: 'system',
  autoUpdate: true,
  checkUpdateBeforeStart: false,
  updateCheckIntervalHours: 3,
})

const themeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
]

/** 远端快照：加载/保存成功后更新，用于脏状态判定 */
const savedSnapshot = ref('')
const settingsDirty = computed(() =>
  savedSnapshot.value !== '' && JSON.stringify({ ...form }) !== savedSnapshot.value,
)

const canApplyImageUpdate = computed(() => {
  if (!updateStatus.value) {
    return false
  }
  return updateStatus.value.image.updateAvailable && updateStatus.value.imageApplySupported
})

const canApplyUpdate = computed(() => {
  if (!updateStatus.value || updateStatus.value.updating) {
    return false
  }
  return canApplyImageUpdate.value
})

const formattedLastCheckedAt = computed(() => formatDisplayDateTime(updateStatus.value?.lastCheckedAt ?? null))
const normalizedCheckError = computed(() => normalizeCheckError(updateStatus.value?.checkError ?? null))

const updateView = computed(() => buildPanelUpdatePresentation(updateStatus.value))
const releaseUrl = computed(() => updateStatus.value?.release?.htmlUrl?.trim() || null)
const manualUpdateCommand = computed(() => updateStatus.value?.manualUpdateCommand?.trim() || null)
const applyButtonLabel = computed(() => updateStatus.value?.updating ? '更新中…' : '应用更新')
const needsManualUpdate = computed(() => updateView.value.needsManualCommand)
const releaseMetaLine = computed(() => {
  const checkedAt = formattedLastCheckedAt.value
  return checkedAt ? `上次检查：${checkedAt}` : null
})

function formatDisplayDateTime(value: string | null): string | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(parsed)
}

function normalizeCheckError(value: string | null): string | null {
  if (!value) {
    return null
  }
  const parts = value
    .split(/[；;\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
  if (parts.length === 0) {
    return null
  }
  return [...new Set(parts)].join('；')
}

async function copyUpdateCommand(command: string, label: string) {
  const value = command.trim()
  if (!value) {
    faToast.warning('暂无可复制的命令')
    return
  }
  const ok = await copyTextToClipboard(value)
  if (!ok) {
    faToast.error('复制失败，请手动选中命令文本复制')
    return
  }
  faToast.success(`${label}已复制`)
}

async function loadSettings(options?: { silent?: boolean }) {
  if (!options?.silent) {
    loading.value = true
  }
  try {
    const res = await apiSystem.getSettings()
    const data = res.data
    form.panelPort = data.panelPort
    form.theme = data.theme
    form.autoUpdate = data.autoUpdate
    form.checkUpdateBeforeStart = data.checkUpdateBeforeStart ?? false
    form.updateCheckIntervalHours = data.updateCheckIntervalHours ?? 3
    savedSnapshot.value = JSON.stringify({ ...form })
    settingsLoaded.value = true
    settingsLoadError.value = null
  }
  catch (error) {
    if (!settingsLoaded.value) {
      const detail = error instanceof Error && error.message ? `：${error.message}` : ''
      settingsLoadError.value = `加载系统设置失败${detail}`
    }
    else if (!options?.silent) {
      faToast.error('刷新失败，页面保留当前设置。')
    }
  }
  finally {
    if (!options?.silent) {
      loading.value = false
    }
  }
}

async function loadUpdateStatus(options?: { silent?: boolean }): Promise<boolean> {
  try {
    const res = await apiSystem.getPanelUpdateStatus()
    updateStatus.value = res.data
    return true
  }
  catch {
    // 轮询期间（silent）请求失败通常意味着面板正在重启：保留上一次状态，界面才不会闪成"无法获取"
    if (!options?.silent) {
      updateStatus.value = null
    }
    return false
  }
}

/** 连续轮询失败次数：面板重建期间会持续失败，超过上限就停止并提示手动刷新 */
let updatePollFailures = 0
const UPDATE_POLL_INTERVAL_MS = 3000
const UPDATE_POLL_MAX_FAILURES = 60

/**
 * 更新进度轮询：「应用更新」现在立即返回，真正的下载与重建在后台跑，
 * 界面靠这里拿到 preparing / pulling / recreating / failed 各阶段。
 */
const updatePoller = usePollingTask(async () => {
  const reachable = await loadUpdateStatus({ silent: true })
  if (!reachable) {
    updatePollFailures += 1
    if (updatePollFailures === 5) {
      faToast.info('面板正在重启，恢复后本页会自动继续刷新。')
    }
    if (updatePollFailures >= UPDATE_POLL_MAX_FAILURES) {
      updatePoller.stop()
      faToast.warning('等待面板重启超时，请手动刷新本页查看结果。')
    }
    return
  }
  updatePollFailures = 0
  const phase = updateStatus.value?.updatePhase
  if (!phase || phase === 'idle' || phase === 'failed') {
    updatePoller.stop()
    if (phase === 'failed') {
      faToast.error('更新失败，请查看「面板与游戏版本」区块中的提示')
    }
  }
}, { intervalMs: UPDATE_POLL_INTERVAL_MS })

const offlineUpdateCommand = computed(() => updateStatus.value?.offlineImageCommand?.trim() || null)

const targetImageHint = computed(() => {
  const status = updateStatus.value
  if (!status?.targetImageReady || !status.targetImage) {
    return null
  }
  return `检测到本地已有 ${status.targetImage}，将直接重建面板，不再下载。`
})

onBeforeUnmount(() => {
  updatePoller.stop()
})

async function checkHubUpdate() {
  updateStatusLoading.value = true
  try {
    const res = await apiSystem.checkPanelUpdate()
    updateStatus.value = res.data
    if (normalizeCheckError(res.data.checkError)) {
      faToast.warning('暂时无法完成版本检查，请查看下方提示')
    }
    else if (res.data.image.updateAvailable) {
      faToast.info('检测到新版本')
    }
    else {
      faToast.success('已是最新版本')
    }
  }
  finally {
    updateStatusLoading.value = false
  }
}

function confirmApplyHubUpdate() {
  dialog.warning({
    title: '确认应用更新',
    content: '更新过程中面板会短暂无法访问，游戏服务器不受影响。是否继续？',
    positiveText: '立即更新',
    negativeText: '取消',
    onPositiveClick: () => applyHubUpdate(),
  })
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
      await loadUpdateStatus({ silent: true })
      updatePollFailures = 0
      updatePoller.start()
    }
    else {
      await loadUpdateStatus()
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '更新失败'
    faToast.error(message)
  }
  finally {
    applyLoading.value = false
  }
}

async function saveSettings() {
  if (!settingsLoaded.value || loading.value) {
    faToast.warning('设置尚未加载完成，请稍后重试。')
    return
  }
  if (!Number.isInteger(form.panelPort) || form.panelPort <= 0 || form.panelPort > 65535) {
    faToast.warning('端口号无效，请输入 1-65535 之间的数字')
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
    appSettingsStore.setColorScheme(form.theme === 'system' ? '' : form.theme)
    faToast.success('系统设置已保存')
    await loadSettings({ silent: true })
  }
  finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadUpdateStatus()])
})

onActivated(async () => {
  await Promise.all([loadSettings({ silent: true }), loadUpdateStatus()])
})
</script>

<template>
  <FaPageMain title="系统设置" class="h-full">
    <NSpin v-if="loading" size="large" class="block mx-auto my-8" />
    <div v-else-if="settingsLoadError || !settingsLoaded" class="space-y-4" role="alert">
      <NAlert type="error" title="无法加载系统设置">
        {{ settingsLoadError ?? '当前设置不可用，请重新加载后再编辑。' }}
      </NAlert>
      <FaButton :loading="loading" @click="loadSettings">
        重试加载
      </FaButton>
    </div>
    <div v-else class="space-y-6">
      <AdminSettingsSection
        title="面板端口"
        description="浏览器打开本面板所使用的端口。"
      >
        <p class="text-sm text-muted-foreground">
          当前访问端口：{{ browserAccessPort }}
        </p>
        <NInputNumber v-model:value="form.panelPort" :min="1" :max="65535" class="max-w-80 mt-3" placeholder="请输入端口号" />
        <p class="text-xs text-muted-foreground mt-2">
          修改端口保存后，需重启面板才能生效。
        </p>
      </AdminSettingsSection>

      <AdminSettingsSection
        title="界面主题"
        description="选择面板的显示主题，保存后立即生效。"
      >
        <NSelect v-model:value="form.theme" :options="themeOptions" class="max-w-80" />
      </AdminSettingsSection>

      <AdminSettingsSection
        title="面板与游戏版本"
        description="检查面板与游戏服务端是否有新版本。"
      >
        <div v-if="updateStatus" class="space-y-2 text-sm">
          <p class="font-medium">
            {{ updateView.versionLine }}
          </p>
          <p
            v-if="updateView.phaseLine"
            class="text-xs whitespace-pre-wrap"
            :class="updateView.updateFailed ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"
          >
            {{ updateView.phaseLine }}
          </p>
          <p v-if="targetImageHint" class="text-xs text-muted-foreground">
            {{ targetImageHint }}
          </p>
          <p v-if="releaseMetaLine" class="text-xs text-muted-foreground">
            {{ releaseMetaLine }}
            <a
              v-if="releaseUrl"
              :href="releaseUrl"
              target="_blank"
              rel="noopener"
              class="ml-1 text-primary hover:underline"
            >
              更新说明
            </a>
          </p>
          <p v-if="normalizedCheckError" class="text-xs text-amber-600 dark:text-amber-400">
            检查提示：{{ normalizedCheckError }}
          </p>
        </div>
        <div v-else class="text-sm text-muted-foreground">
          暂时无法获取版本信息
        </div>

        <div class="space-y-2 pt-1">
          <div class="flex flex-wrap gap-2">
            <FaButton
              :loading="applyLoading"
              :disabled="!canApplyUpdate"
              @click="confirmApplyHubUpdate"
            >
              {{ applyButtonLabel }}
            </FaButton>
            <FaButton variant="outline" :loading="updateStatusLoading" @click="checkHubUpdate">
              检查更新
            </FaButton>
          </div>
          <div v-if="needsManualUpdate" class="flex flex-wrap gap-2 items-center text-xs">
            <span class="text-amber-600 dark:text-amber-400">{{ MANUAL_UPDATE_NOTE }}</span>
            <code class="bg-muted px-2 py-1 rounded-md">{{ MANUAL_UPDATE_COMMAND }}</code>
            <FaButton
              variant="outline"
              size="sm"
              @click="copyUpdateCommand(MANUAL_UPDATE_COMMAND, '更新命令')"
            >
              复制
            </FaButton>
          </div>
        </div>

        <NCollapse v-if="offlineUpdateCommand" class="pt-1">
          <NCollapseItem title="下载慢或失败？改用离线镜像包" name="offline-update">
            <div class="space-y-2 text-sm">
              <p class="text-xs text-muted-foreground">
                在无法稳定访问 GHCR 的服务器上，可在能访问 GitHub 的机器或服务器上下载离线镜像包并导入：
              </p>
              <pre class="text-xs bg-muted overflow-x-auto p-3 rounded-md">{{ offlineUpdateCommand }}</pre>
              <div class="flex flex-wrap gap-2 items-center">
                <FaButton
                  variant="outline"
                  size="sm"
                  @click="copyUpdateCommand(offlineUpdateCommand ?? '', '离线更新命令')"
                >
                  复制
                </FaButton>
                <span class="text-xs text-muted-foreground">
                  导入后回到本页再次点击「应用更新」，面板会检测到本地镜像并直接重建。
                </span>
              </div>
            </div>
          </NCollapseItem>
        </NCollapse>

        <NCollapse v-if="needsManualUpdate && manualUpdateCommand" class="pt-1">
          <NCollapseItem title="其他更新方式" name="manual-update">
            <div class="space-y-2 text-sm">
              <pre class="text-xs bg-muted overflow-x-auto p-3 rounded-md">{{ manualUpdateCommand }}</pre>
              <div class="flex flex-wrap gap-2 items-center">
                <FaButton
                  variant="outline"
                  size="sm"
                  @click="copyUpdateCommand(manualUpdateCommand ?? '', '备用命令')"
                >
                  复制
                </FaButton>
                <span class="text-xs text-muted-foreground">{{ MANUAL_UPDATE_HINT }}</span>
              </div>
            </div>
          </NCollapseItem>
        </NCollapse>
      </AdminSettingsSection>

      <AdminSettingsSection
        title="自动检查更新"
        description="按设定间隔自动检查面板是否有新版本。"
      >
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.autoUpdate" />
          <span class="text-sm text-muted-foreground">
            {{ form.autoUpdate ? '已开启自动检查' : '已关闭自动检查' }}
          </span>
        </div>
        <div class="space-y-2 max-w-80">
          <label class="text-sm text-muted-foreground">检查间隔（小时）</label>
          <NInputNumber v-model:value="form.updateCheckIntervalHours" :min="1" :max="168" placeholder="1-168" class="w-full" />
        </div>
      </AdminSettingsSection>

      <AdminSettingsSection
        title="启动前检查游戏更新"
        description="启动或重启游戏服务器前，先向 Steam 检查是否有新版本。"
      >
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.checkUpdateBeforeStart" />
          <span class="text-sm text-muted-foreground">
            {{ form.checkUpdateBeforeStart ? '启动前自动检查游戏更新，避免版本过旧' : '启动前不检查游戏更新' }}
          </span>
        </div>
      </AdminSettingsSection>

        <ConfigActionBar
          :dirty="settingsDirty"
          :saving="saveLoading"
          :show-restart="false"
          save-label="保存设置"
          @reset="loadSettings"
          @save="saveSettings"
        />
    </div>
  </FaPageMain>
</template>
