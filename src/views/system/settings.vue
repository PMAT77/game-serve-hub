<script setup lang="ts">
import type { PanelSettingsPayload } from '@/api/modules/system'
import { NAlert, NInputNumber, NSelect, NSkeleton, useDialog } from 'naive-ui'
import AdminSettingsSection from '@/components/AdminSettingsSection.vue'
import ConfigActionBar from '@/components/ConfigActionBar.vue'
import apiSystem from '@/api/modules/system'

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
const apiPort = ref<number | null>(null)

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

const isSplitDevMode = computed(() => {
  if (apiPort.value === null) {
    return false
  }
  return browserAccessPort.value !== apiPort.value
})

const form = reactive<PanelSettingsPayload>({
  panelPort: 80,
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

const canApplyPanelUpdate = computed(() => {
  if (!updateStatus.value) {
    return false
  }
  return updateStatus.value.panel.updateAvailable && updateStatus.value.panelApplySupported
})

const isNativeRuntime = computed(() => updateStatus.value?.runtimeMode === 'native')
const panelVersionLabel = computed(() => isNativeRuntime.value ? '面板 Release' : '面板镜像')
const dstVersionLabel = computed(() => isNativeRuntime.value ? 'DST 原生运行时' : 'DST 运行镜像')

const canApplyDstUpdate = computed(() => {
  if (!updateStatus.value) {
    return false
  }
  return updateStatus.value.dst.updateAvailable && updateStatus.value.dstApplySupported
})

const canApplyUpdate = computed(() => {
  if (!updateStatus.value || updateStatus.value.updating) {
    return false
  }
  return canApplyPanelUpdate.value || canApplyDstUpdate.value
})

const showPanelApplyHint = computed(() => {
  if (!updateStatus.value) {
    return false
  }
  return updateStatus.value.panel.updateAvailable && !updateStatus.value.panelApplySupported
})

const formattedLastCheckedAt = computed(() => formatDisplayDateTime(updateStatus.value?.lastCheckedAt ?? null))
const normalizedCheckError = computed(() => normalizeCheckError(updateStatus.value?.checkError ?? null))
const normalizedApplyHint = computed(() => normalizeApplyHint(updateStatus.value?.applyHint ?? null))

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

function normalizeApplyHint(value: string | null): string | null {
  if (!value) {
    return null
  }
  if (/无法在容器内访问 compose|未配置 GSH_STACK_DIR|GSH_STACK_DIR 必须是绝对路径/.test(value)) {
    return '面板镜像无法一键更新，请使用下方命令手动更新；DST 运行镜像仍可点击「立即更新」。'
  }
  return value
}

function formatImageLine(
  label: string,
  info: NonNullable<typeof updateStatus.value>['panel'],
) {
  const version = info.releaseVersion || info.tag
  const digest = info.localDigestShort ? ` · ${info.localDigestShort}` : ''
  const status = info.updateAvailable ? '（有新版本）' : '（已是最新）'
  return `${label}：${version}${digest}${status}`
}

async function loadSettings(options?: { silent?: boolean }) {
  if (!options?.silent) {
    loading.value = true
  }
  try {
    const res = await apiSystem.getSettings()
    const data = res.data
    apiPort.value = data.apiPort
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
      apiPort.value = null
    }
    else if (!options?.silent) {
      faToast.error('刷新系统设置失败，当前页面保留上次成功加载的数据。')
    }
  }
  finally {
    if (!options?.silent) {
      loading.value = false
    }
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
    if (normalizeCheckError(res.data.checkError)) {
      faToast.warning('无法完成远端版本检查，请查看下方检查提示')
    }
    else if (res.data.panel.updateAvailable || res.data.dst.updateAvailable) {
      faToast.info(isNativeRuntime.value ? '检测到面板 Release 有新版本' : '检测到面板镜像有新版本')
    }
    else {
      faToast.success(isNativeRuntime.value ? '面板已是最新版本' : '面板镜像已是最新版本')
    }
  }
  finally {
    updateStatusLoading.value = false
  }
}

function confirmApplyHubUpdate() {
  dialog.warning({
    title: '确认应用更新',
    content: isNativeRuntime.value
      ? '将原地升级面板；升级过程中面板会短暂不可用。是否继续？'
      : '应用更新会拉取新镜像并短暂重启面板；游戏实例不受影响。是否继续？',
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
    const targets: Array<'panel' | 'dst'> = []
    if (canApplyPanelUpdate.value) {
      targets.push('panel')
    }
    if (canApplyDstUpdate.value) {
      targets.push('dst')
    }
    const res = await apiSystem.applyPanelUpdate({ targets })
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
  catch (error) {
    const message = error instanceof Error ? error.message : 'Hub 镜像更新失败'
    faToast.error(message)
  }
  finally {
    applyLoading.value = false
  }
}

async function saveSettings() {
  if (!settingsLoaded.value || loading.value) {
    faToast.warning('请先成功加载系统设置后再保存。')
    return
  }
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
    <div v-if="loading" class="space-y-4" aria-busy="true" aria-label="加载中">
      <NSkeleton v-for="i in 5" :key="i" text :style="{ width: i === 5 ? '40%' : '100%' }" />
    </div>
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
        description="设置浏览器访问面板的对外端口。开发双容器环境下请区分浏览器端口与 API 端口。"
      >
        <div v-if="isSplitDevMode" class="text-sm text-muted-foreground space-y-1">
          <p>当前访问端口：{{ browserAccessPort }}（浏览器地址栏）</p>
          <p>后端 API 端口：{{ apiPort }}（开发双容器，仅内部/直连 API 使用）</p>
        </div>
        <p v-else class="text-sm text-muted-foreground">
          当前访问端口：{{ browserAccessPort }}
        </p>
        <NInputNumber v-model:value="form.panelPort" :min="1" :max="65535" class="max-w-80 mt-3" placeholder="请输入对外发布端口" />
        <p class="text-xs text-muted-foreground mt-2">
          <template v-if="isSplitDevMode">
            开发环境请用 {{ browserAccessPort }} 打开面板；修改端口保存后需重启面板服务生效。
          </template>
          <template v-else>
            端口范围 1-65535，保存后需重启面板服务生效。
          </template>
        </p>
      </AdminSettingsSection>

      <AdminSettingsSection
        title="界面主题"
        description="选择管理面板的显示主题；保存后立即应用到当前浏览器。"
      >
        <NSelect v-model:value="form.theme" :options="themeOptions" class="max-w-80" />
      </AdminSettingsSection>

      <AdminSettingsSection
        title="面板与游戏版本"
        :description="isNativeRuntime
          ? '检查面板 Release；裸机模式通过校验安装包并保留旧版本的脚本原地升级。'
          : '检查并应用面板与 DST 运行镜像更新。应用面板更新会短暂重启管理端。'"
      >
        <div v-if="updateStatus" class="space-y-2 text-sm">
          <p>{{ formatImageLine(panelVersionLabel, updateStatus.panel) }}</p>
          <p>{{ formatImageLine(dstVersionLabel, updateStatus.dst) }}</p>
          <p v-if="updateStatus.release" class="text-muted-foreground">
            最新 Release：{{ updateStatus.release.tagName }}
            <span v-if="formattedLastCheckedAt"> · 上次检查 {{ formattedLastCheckedAt }}</span>
          </p>
          <p v-else-if="formattedLastCheckedAt" class="text-xs text-muted-foreground">
            上次检查：{{ formattedLastCheckedAt }}
          </p>
          <p v-if="normalizedCheckError" class="text-xs text-amber-600 dark:text-amber-400">
            检查提示：{{ normalizedCheckError }}
          </p>
          <p v-if="normalizedApplyHint && showPanelApplyHint" class="text-xs text-muted-foreground">
            {{ normalizedApplyHint }}
          </p>
          <pre
            v-if="updateStatus.manualUpdateCommand && showPanelApplyHint"
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
          <FaButton
            :loading="applyLoading"
            :disabled="!canApplyUpdate"
            @click="confirmApplyHubUpdate"
          >
            应用更新
          </FaButton>
          <FaButton variant="outline" :loading="updateStatusLoading" @click="checkHubUpdate">
            检查更新
          </FaButton>
        </div>
      </AdminSettingsSection>

      <AdminSettingsSection
        :title="isNativeRuntime ? '面板自动检查更新' : '面板镜像自动检查更新'"
        :description="isNativeRuntime ? '按间隔自动检查 GitHub Release 是否有新版本。' : '按间隔自动检查面板镜像是否有新版本。'"
      >
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.autoUpdate" />
          <span class="text-sm text-muted-foreground">
            {{ form.autoUpdate
              ? `已启用面板${isNativeRuntime ? ' Release' : '镜像'}自动检查`
              : `已关闭面板${isNativeRuntime ? ' Release' : '镜像'}自动检查` }}
          </span>
        </div>
        <div class="space-y-2 max-w-80">
          <label class="text-sm text-muted-foreground">检查间隔（小时）</label>
          <NInputNumber v-model:value="form.updateCheckIntervalHours" :min="1" :max="168" placeholder="1-168" class="w-full" />
        </div>
      </AdminSettingsSection>

      <AdminSettingsSection
        title="启动前检查游戏更新"
        description="启动或重启实例前，向 Steam 核对服务端 Build ID 是否与本地一致。"
      >
        <div class="flex gap-3 items-center">
          <FaSwitch v-model="form.checkUpdateBeforeStart" />
          <span class="text-sm text-muted-foreground">
            {{ form.checkUpdateBeforeStart ? '启动前将向 Steam 检查 Build ID，有新版时将阻止启动' : '启动时不额外检查 Steam 远端版本' }}
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
