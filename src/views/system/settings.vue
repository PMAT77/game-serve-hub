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
  if (/缺少 compose 文件|缺少环境文件|未配置 GSH_STACK_DIR|GSH_STACK_DIR 必须是绝对路径/.test(value)) {
    return '当前环境不支持一键更新，请使用下方命令手动更新。'
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
  await loadSettings({ silent: true })
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
        <div v-if="isSplitDevMode" class="text-sm text-muted-foreground space-y-1">
          <p>当前访问端口：{{ browserAccessPort }}（浏览器地址栏）</p>
          <p>后端 API 端口：{{ apiPort }}（开发双容器，仅内部/直连 API 使用）</p>
        </div>
        <p v-else class="text-sm text-muted-foreground">
          当前访问端口：{{ browserAccessPort }}
        </p>
        <FaInput v-model="panelPortInput" type="text" class="max-w-80" placeholder="请输入对外发布端口" />
        <p class="text-xs text-muted-foreground">
          <template v-if="isSplitDevMode">
            开发环境前后端分离：请用 {{ browserAccessPort }} 打开面板。下方为生产/网关对外发布端口（当前 API {{ apiPort }}），保存后下次重启 dev:compose 生效。
          </template>
          <template v-else>
            端口范围 1-65535，保存后由网关编排模块统一生效。
          </template>
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
            <span v-if="formattedLastCheckedAt"> · 上次检查 {{ formattedLastCheckedAt }}</span>
          </p>
          <p v-else-if="formattedLastCheckedAt" class="text-xs text-muted-foreground">
            上次检查：{{ formattedLastCheckedAt }}
          </p>
          <p v-if="normalizedCheckError" class="text-xs text-amber-600 dark:text-amber-400">
            检查提示：{{ normalizedCheckError }}
          </p>
          <p v-if="normalizedApplyHint && hasHubUpdate" class="text-xs text-muted-foreground">
            {{ normalizedApplyHint }}
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
          仅更新检测到新版本的镜像。面板更新会短暂重启管理面板（约 30 秒），通常不会中断已运行游戏实例；DST 运行镜像更新后需重启实例才生效。
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
