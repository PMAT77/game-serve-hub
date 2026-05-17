<script setup lang="ts">
import type { DataTableColumns, FormInst, FormRules } from 'naive-ui'
import type { CreateInstancePayload, InstallableGameItem, InstanceInstallLogPayload, InstanceInstallLogSource, InstanceItem, InstanceStatus } from '@/api/modules/instance'
import type { NodeListItem } from '@/api/modules/node'
import { NButton, NProgress, useDialog } from 'naive-ui'
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRefs, watch } from 'vue'
import apiInstance from '@/api/modules/instance'
import { formatDateTime } from '../utils'

defineOptions({
  name: 'NodeInstanceManagementPanel',
})

const props = defineProps<Props>()

interface Props {
  nodes: NodeListItem[]
  steamcmdInstalled: boolean
  steamcmdConfigured: boolean
}

const { nodes, steamcmdInstalled, steamcmdConfigured } = toRefs(props)

const dialog = useDialog()

const instanceLoading = ref(false)
const createLoading = ref(false)
const actionLoadingId = ref('')
const instances = ref<InstanceItem[]>([])

const keywordFilter = ref('')
const statusFilter = ref<'all' | InstanceStatus>('all')
const selectedNodeId = ref<string>('all')
const createModalVisible = ref(false)
const createFormRef = ref<FormInst | null>(null)
const installableGames = ref<InstallableGameItem[]>([])
const installLogVisible = ref(false)
const installLogLoading = ref(false)
const installLogContent = ref('')
const installLogMeta = ref<InstanceInstallLogPayload | null>(null)
const installLogInstanceName = ref('')
const installLogTargetId = ref('')
let installLogPollTimer: ReturnType<typeof setInterval> | undefined

/** 列宽总和，启用横向滚动，避免中间列被挤压为 0 */
const INSTANCE_TABLE_SCROLL_X = 1260

const createForm = reactive<CreateInstancePayload>({
  nodeId: '',
  name: '',
  gameCode: '',
  installPath: '',
  configPath: '',
})

const nodeOptions = computed(() => {
  return [
    { label: '全部节点', value: 'all' },
    ...nodes.value.map(node => ({ label: node.name, value: node.id })),
  ]
})

const createNodeOptions = computed(() => {
  return nodes.value.map(node => ({ label: node.name, value: node.id }))
})

const createGameOptions = computed(() => {
  return installableGames.value.map(game => ({
    label: `${game.name} (${game.appId})`,
    value: game.appId,
  }))
})

const statusFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '未安装', value: 'pending_install' },
  { label: '运行中', value: 'running' },
  { label: '已停止', value: 'stopped' },
  { label: '安装中', value: 'installing' },
  { label: '异常', value: 'error' },
]

const createFormRules: FormRules = {
  nodeId: [
    {
      required: true,
      message: '请选择节点',
      trigger: ['change', 'blur'],
    },
  ],
  name: [
    {
      required: true,
      trigger: ['input', 'blur'],
      validator: (_rule, value: string) => {
        if (value?.trim()) {
          return true
        }
        return new Error('请输入实例名称')
      },
    },
  ],
  gameCode: [
    {
      required: true,
      trigger: ['change', 'blur'],
      validator: (_rule, value: string) => {
        if (value?.trim()) {
          return true
        }
        return new Error('请选择游戏 AppID')
      },
    },
  ],
}

const statusCount = computed(() => {
  return {
    total: instances.value.length,
    pendingInstall: instances.value.filter(item => item.status === 'pending_install').length,
    running: instances.value.filter(item => item.status === 'running').length,
    stopped: instances.value.filter(item => item.status === 'stopped').length,
    installing: instances.value.filter(item => item.status === 'installing').length,
    error: instances.value.filter(item => item.status === 'error').length,
  }
})

const filteredInstances = computed(() => instances.value)

const instanceColumns = computed<DataTableColumns<InstanceItem>>(() => {
  return [
    {
      title: '实例名称',
      key: 'name',
      width: 180,
    },
    {
      title: 'Steam AppID',
      key: 'gameCode',
      width: 140,
    },
    {
      title: '节点',
      key: 'nodeId',
      width: 180,
      render: row => getNodeName(row.nodeId),
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: row =>
        h(
          'span',
          {
            class: `text-xs px-2 py-0.5 rounded-full ${getStatusBadgeClass(row.status)}`,
          },
          getStatusLabel(row.status),
        ),
    },
    {
      title: '安装',
      key: 'install',
      width: 200,
      ellipsis: { tooltip: true },
      render: row => renderInstallColumn(row),
    },
    {
      title: '日志',
      key: 'installLog',
      width: 108,
      render: (row) => {
        const canOpen = canOpenInstallLog(row)
        return h(
          NButton,
          {
            size: 'small',
            secondary: true,
            disabled: !canOpen,
            title: canOpen ? '查看 SteamCMD 安装输出' : '暂无安装日志',
            onClick: () => openInstallLogModal(row),
          },
          { default: () => '查看日志' },
        )
      },
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 150,
      render: row => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: row =>
        h('div', { class: 'flex flex-wrap gap-4' }, [
          h(
            NButton,
            {
              size: 'small',
              text: true,
              loading: isActionLoading(row.id, 'start'),
              disabled: row.status === 'running' || row.status === 'pending_install' || row.status === 'installing',
              onClick: () => runInstanceAction(row.id, 'start'),
            },
            { default: () => '启动' },
          ),
          h(
            NButton,
            {
              size: 'small',
              text: true,
              loading: isActionLoading(row.id, 'stop'),
              disabled: row.status === 'stopped',
              onClick: () => confirmDangerousInstanceAction(row, 'stop'),
            },
            { default: () => '停止' },
          ),
          h(
            NButton,
            {
              size: 'small',
              text: true,
              loading: isActionLoading(row.id, 'restart'),
              onClick: () => confirmDangerousInstanceAction(row, 'restart'),
            },
            { default: () => '重启' },
          ),
          h(
            NButton,
            {
              type: 'error',
              size: 'small',
              text: true,
              onClick: () => confirmDangerousInstanceAction(row, 'delete'),
            },
            { default: () => '删除' },
          ),
        ]),
    },
  ]
})

watch(nodes, (list) => {
  if (!createForm.nodeId && list.length > 0) {
    createForm.nodeId = list[0].id
  }
}, { immediate: true })

function getInstanceRowKey(row: InstanceItem) {
  return row.id
}

function getStatusLabel(status: InstanceStatus) {
  switch (status) {
    case 'pending_install':
      return '未安装'
    case 'running':
      return '运行中'
    case 'stopped':
      return '已停止'
    case 'installing':
      return '安装中'
    case 'error':
      return '异常'
  }
}

function getStatusBadgeClass(status: InstanceStatus) {
  switch (status) {
    case 'pending_install':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
    case 'running':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'stopped':
      return 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
    case 'installing':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
    case 'error':
      return 'bg-red-500/10 text-red-600 dark:text-red-300'
  }
}

function looksLikeRuntimeCommand(text: string | null | undefined) {
  if (!text?.trim()) {
    return false
  }
  return /\.(?:sh|bat|cmd)\b/i.test(text)
    || /\bdontstarve\b/i.test(text)
    || /\bdedicated_server\b/i.test(text)
}

function resolveInstallPhase(instance: InstanceItem): string {
  const command = instance.lastCommand?.trim() ?? ''
  const error = instance.lastError?.trim() ?? ''
  const text = `${command}\n${error}`.trim()

  if (instance.status === 'error') {
    if (error.includes('安装失败') || command.includes('安装失败')) {
      return '安装失败'
    }
    return error ? '安装失败' : '安装异常'
  }

  if (!text) {
    return instance.status === 'pending_install' ? '等待安装' : '安装中'
  }
  if (text.includes('等待安装')) {
    return '等待安装'
  }
  if (text.includes('正在准备')) {
    return '准备安装'
  }
  if (text.includes('登录重试') || text.includes('账号登录')) {
    return '账号登录重试'
  }
  if (/安装进度\s*\d+%/.test(text) || /\[\s*\d+%\]/.test(text) || /update state/i.test(text) || /downloading/i.test(text)) {
    return '下载游戏'
  }
  if (text.includes('安装完成') || text.includes('启动脚本')) {
    return '生成启动脚本'
  }
  if (/\d{1,3}\s*%/.test(text)) {
    return '下载游戏'
  }
  if (instance.status === 'installing' || instance.status === 'pending_install') {
    return '安装处理中'
  }
  return '—'
}

function extractInstallProgressPercent(instance: InstanceItem): number | null {
  const sources = [instance.lastCommand, instance.lastError]
  for (const text of sources) {
    if (!text) {
      continue
    }
    const normalizedMatch = text.match(/安装进度\s*(\d{1,3})\s*%/)
    if (normalizedMatch) {
      return Math.max(0, Math.min(100, Number(normalizedMatch[1])))
    }
    const bracketMatch = text.match(/\[\s*(\d{1,3})%\]/)
    if (bracketMatch) {
      return Math.max(0, Math.min(100, Number(bracketMatch[1])))
    }
    const genericMatch = text.match(/(\d{1,3})\s*%/)
    if (genericMatch) {
      return Math.max(0, Math.min(100, Number(genericMatch[1])))
    }
  }
  return null
}

function shouldShowInstallDetail(instance: InstanceItem) {
  return instance.status === 'pending_install'
    || instance.status === 'installing'
    || instance.status === 'error'
}

function renderInstallColumn(instance: InstanceItem) {
  if (instance.status === 'running' || instance.status === 'stopped') {
    return h('span', { class: 'text-sm text-muted-foreground' }, '已安装')
  }
  if (!shouldShowInstallDetail(instance)) {
    return h('span', { class: 'text-sm text-muted-foreground' }, '—')
  }

  const phase = resolveInstallPhase(instance)
  const progress = extractInstallProgressPercent(instance)
  const errorHint = instance.status === 'error' ? instance.lastError?.trim() : ''

  if (progress !== null) {
    return h('div', { class: 'w-44 space-y-1' }, [
      h(NProgress, {
        percentage: progress,
        indicatorPlacement: 'inside',
        processing: instance.status === 'installing' && progress < 100,
        height: 14,
        showIndicator: true,
      }),
      h('p', { class: 'text-xs text-muted-foreground truncate' }, `${phase} · ${progress}%`),
      errorHint
        ? h('p', { class: 'text-xs text-red-500 truncate', title: errorHint }, errorHint)
        : null,
    ])
  }

  return h('div', { class: 'space-y-0.5 max-w-48' }, [
    h('span', { class: 'text-sm' }, phase),
    errorHint
      ? h('p', { class: 'text-xs text-red-500 truncate', title: errorHint }, errorHint)
      : null,
  ])
}

function canOpenInstallLog(instance: InstanceItem) {
  if (instance.status === 'pending_install' || instance.status === 'installing' || instance.status === 'error') {
    return true
  }
  if (instance.lastError?.trim()) {
    return true
  }
  const command = instance.lastCommand?.trim()
  if (!command) {
    return false
  }
  if (looksLikeRuntimeCommand(command)) {
    return false
  }
  return command.includes('安装')
    || command.includes('Steam')
    || command.includes('steamcmd')
    || command.includes('脚本')
}

function getInstallLogSourceLabel(source: InstanceInstallLogSource | undefined) {
  switch (source) {
    case 'install_log':
      return '完整 SteamCMD 输出'
    case 'status_summary':
      return '最近状态摘要（非完整日志）'
    case 'empty':
      return '暂无日志'
    default:
      return '未知'
  }
}

function getInstallLogStatusLabel(status: InstanceInstallLogPayload['status'] | undefined) {
  switch (status) {
    case 'running':
      return '安装进行中'
    case 'success':
      return '安装成功'
    case 'failed':
      return '安装失败'
    case 'unknown':
      return '未知'
    default:
      return '未知'
  }
}

function getNodeName(nodeId: string) {
  return nodes.value.find(node => node.id === nodeId)?.name ?? nodeId
}

function confirmDangerousInstanceAction(row: InstanceItem, action: 'stop' | 'restart' | 'delete') {
  const actionConfig = {
    stop: {
      title: '确认停止',
      content: `确认停止实例「${row.name}」吗？`,
      positiveText: '停止',
      type: 'warning' as const,
    },
    restart: {
      title: '确认重启',
      content: `确认重启实例「${row.name}」吗？`,
      positiveText: '重启',
      type: 'warning' as const,
    },
    delete: {
      title: '确认删除',
      content: `确认删除实例「${row.name}」吗？若正在运行将先自动停止，并清理该实例安装目录。`,
      positiveText: '删除',
      type: 'error' as const,
    },
  }[action]

  dialog.warning({
    title: actionConfig.title,
    content: actionConfig.content,
    positiveText: actionConfig.positiveText,
    negativeText: '取消',
    positiveButtonProps: {
      type: actionConfig.type,
    },
    onPositiveClick: () => {
      if (action === 'delete') {
        return runInstanceAction(row.id, action, { useTableLoading: false })
      }
      void runInstanceAction(row.id, action)
    },
  })
}

function resetCreateForm() {
  createForm.name = ''
  createForm.gameCode = ''
  createForm.installPath = ''
  createForm.configPath = ''
}

function openCreateModal() {
  if (!createForm.nodeId && nodes.value.length > 0) {
    createForm.nodeId = nodes.value[0].id
  }
  resetCreateForm()
  if (installableGames.value.length > 0) {
    createForm.gameCode = installableGames.value[0].appId
  }
  createModalVisible.value = true
  nextTick(() => {
    createFormRef.value?.restoreValidation()
  })
}

function closeCreateModal() {
  createModalVisible.value = false
  createFormRef.value?.restoreValidation()
}

async function fetchInstallableGames() {
  const res = await apiInstance.getInstallableGames()
  installableGames.value = res.data
}

function stopInstallLogPolling() {
  if (installLogPollTimer) {
    clearInterval(installLogPollTimer)
    installLogPollTimer = undefined
  }
}

function shouldPollInstallLog() {
  if (!installLogTargetId.value) {
    return false
  }
  const row = instances.value.find(item => item.id === installLogTargetId.value)
  const status = row?.status
  return status === 'pending_install' || status === 'installing'
}

async function fetchInstallLogContent(options?: { silent?: boolean }) {
  if (!installLogTargetId.value) {
    return
  }
  if (!options?.silent) {
    installLogLoading.value = true
  }
  try {
    const res = await apiInstance.getInstanceInstallLog(installLogTargetId.value)
    installLogMeta.value = res.data
    installLogContent.value = res.data.content || '暂无 SteamCMD 安装输出'
  }
  finally {
    if (!options?.silent) {
      installLogLoading.value = false
    }
  }
}

function startInstallLogPolling() {
  stopInstallLogPolling()
  if (!shouldPollInstallLog()) {
    return
  }
  installLogPollTimer = setInterval(() => {
    if (!installLogVisible.value) {
      stopInstallLogPolling()
      return
    }
    if (shouldPollInstallLog()) {
      void fetchInstallLogContent({ silent: true })
    }
    else {
      stopInstallLogPolling()
    }
  }, 3000)
}

async function openInstallLogModal(instance: InstanceItem) {
  installLogTargetId.value = instance.id
  installLogInstanceName.value = instance.name
  installLogVisible.value = true
  installLogContent.value = ''
  installLogMeta.value = null
  await fetchInstallLogContent()
  startInstallLogPolling()
}

async function fetchInstances() {
  instanceLoading.value = true
  try {
    const res = await apiInstance.getInstanceList({
      nodeId: selectedNodeId.value !== 'all' ? selectedNodeId.value : undefined,
      status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
      keyword: keywordFilter.value.trim() || undefined,
    })
    instances.value = res.data
  }
  finally {
    instanceLoading.value = false
  }
}

async function handleFilterChange() {
  await fetchInstances()
}

async function refreshInstancesAndResetKeyword() {
  keywordFilter.value = ''
  await fetchInstances()
}

async function createInstance() {
  if (!steamcmdInstalled.value) {
    faToast.error('请先安装 SteamCMD，再创建实例')
    return
  }
  if (!steamcmdConfigured.value) {
    faToast.error('请先保存 SteamCMD 配置，再创建实例')
    return
  }
  try {
    await createFormRef.value?.validate()
  }
  catch {
    return
  }

  createLoading.value = true
  try {
    await apiInstance.createInstance({
      nodeId: createForm.nodeId,
      name: createForm.name.trim(),
      gameCode: createForm.gameCode,
      installPath: createForm.installPath?.trim(),
      configPath: createForm.configPath?.trim(),
    })
    faToast.success('实例创建成功，已进入后台安装流程')
    createModalVisible.value = false
    resetCreateForm()
    await fetchInstances()
  }
  finally {
    createLoading.value = false
  }
}

async function runInstanceAction(
  instanceId: string,
  action: 'start' | 'stop' | 'restart' | 'delete',
  options?: { useTableLoading?: boolean },
) {
  const useTableLoading = options?.useTableLoading ?? true
  if (useTableLoading) {
    actionLoadingId.value = `${action}:${instanceId}`
  }
  try {
    if (action === 'start') {
      await apiInstance.startInstance(instanceId)
      faToast.success('实例已启动')
    }
    else if (action === 'stop') {
      await apiInstance.stopInstance(instanceId)
      faToast.success('实例已停止')
    }
    else if (action === 'restart') {
      await apiInstance.restartInstance(instanceId)
      faToast.success('实例已重启')
    }
    else {
      await apiInstance.deleteInstance(instanceId)
      faToast.success('实例已删除')
    }
    await fetchInstances()
  }
  finally {
    if (useTableLoading) {
      actionLoadingId.value = ''
    }
  }
}

function isActionLoading(instanceId: string, action: 'start' | 'stop' | 'restart' | 'delete') {
  return actionLoadingId.value === `${action}:${instanceId}`
}

onMounted(async () => {
  await Promise.all([
    fetchInstallableGames(),
    fetchInstances(),
  ])
})

const instancePollingTimer = setInterval(() => {
  if (instances.value.some(item => item.status === 'pending_install' || item.status === 'installing')) {
    void fetchInstances()
  }
}, 4000)

onBeforeUnmount(() => {
  clearInterval(instancePollingTimer)
  stopInstallLogPolling()
})
</script>

<template>
  <FaPageMain title="实例管理">
    <section class="p-4 border border-border rounded-xl bg-card space-y-4">
      <div class="gap-3 grid md:grid-cols-4">
        <div class="p-3 rounded-md bg-muted/40">
          <p class="text-xs text-muted-foreground">
            实例总数
          </p>
          <p class="text-lg font-semibold mt-1">
            {{ statusCount.total }}
          </p>
        </div>
        <div class="p-3 rounded-md bg-muted/40">
          <p class="text-xs text-muted-foreground">
            运行中
          </p>
          <p class="text-lg text-emerald-600 font-semibold mt-1 dark:text-emerald-400">
            {{ statusCount.running }}
          </p>
        </div>
        <div class="p-3 rounded-md bg-muted/40">
          <p class="text-xs text-muted-foreground">
            已停止
          </p>
          <p class="text-lg text-slate-600 font-semibold mt-1 dark:text-slate-300">
            {{ statusCount.stopped }}
          </p>
        </div>
        <div class="p-3 rounded-md bg-muted/40">
          <p class="text-xs text-muted-foreground">
            异常
          </p>
          <p class="text-lg text-red-600 font-semibold mt-1 dark:text-red-400">
            {{ statusCount.error }}
          </p>
        </div>
      </div>

      <div class="gap-3 grid">
        <div class="flex gap-2 items-center">
          <NInput
            v-model:value="keywordFilter"
            class="w-64"
            placeholder="实例名称/Steam AppID"
            @keydown.enter="fetchInstances"
          />
          <NButton type="primary" strong secondary :loading="instanceLoading" @click="fetchInstances">
            查询
          </NButton>
          <NButton @click="refreshInstancesAndResetKeyword">
            重置
          </NButton>
        </div>
        <div class="filter-toolbar">
          <div class="filter-field">
            <label class="text-sm text-muted-foreground">节点：</label>
            <NSelect
              v-model:value="selectedNodeId"
              :options="nodeOptions"
              class="filter-select"
              @update:value="handleFilterChange"
            />
          </div>
          <div class="filter-field">
            <label class="text-sm text-muted-foreground">状态：</label>
            <NSelect
              v-model:value="statusFilter"
              :options="statusFilterOptions"
              class="filter-select"
              @update:value="handleFilterChange"
            />
          </div>
          <NButton type="primary" class="create-instance-btn" @click="openCreateModal">
            <template #icon>
              <FaIcon name="i-ri:add-line" />
            </template>
            创建实例
          </NButton>
        </div>
      </div>

      <div class="instance-table-shell">
        <NDataTable
          :bordered="false"
          :single-line="false"
          size="small"
          :scroll-x="INSTANCE_TABLE_SCROLL_X"
          :columns="instanceColumns"
          :data="filteredInstances"
          :row-key="getInstanceRowKey"
          :loading="instanceLoading"
          class="w-full"
        >
          <template #empty>
            <div class="text-muted-foreground py-8 text-center">
              暂无实例数据
            </div>
          </template>
        </NDataTable>
      </div>
    </section>

    <NModal
      v-model:show="createModalVisible"
      preset="card"
      title="创建实例"
      :style="{ width: '640px' }"
    >
      <NForm
        ref="createFormRef"
        :model="createForm"
        :rules="createFormRules"
        label-placement="left"
        class="space-y-3"
      >
        <NFormItem label="目标节点" path="nodeId">
          <NSelect
            v-model:value="createForm.nodeId"
            :options="createNodeOptions"
            placeholder="请选择目标节点"
          />
        </NFormItem>
        <NFormItem label="实例名称" path="name">
          <NInput v-model:value="createForm.name" placeholder="如：饥荒联机#1" />
        </NFormItem>
        <NFormItem label="Steam AppID" path="gameCode">
          <NSelect
            v-model:value="createForm.gameCode"
            :options="createGameOptions"
            placeholder="请选择可安装游戏"
          />
        </NFormItem>
        <NFormItem label="安装目录（可选）" path="installPath">
          <NInput v-model:value="createForm.installPath" placeholder="默认：<installRoot>/<gameCode>/<instanceId>" />
        </NFormItem>
      </NForm>

      <template #footer>
        <NSpace justify="end">
          <NButton @click="closeCreateModal">
            取消
          </NButton>
          <NButton type="primary" :loading="createLoading" @click="createInstance">
            确定
          </NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="installLogVisible"
      preset="card"
      :title="`SteamCMD 安装输出 - ${installLogInstanceName || '实例'}`"
      :style="{ width: '760px' }"
      @after-leave="stopInstallLogPolling"
    >
      <div class="space-y-3">
        <div class="text-xs text-muted-foreground space-y-1">
          <p>
            <span>来源：{{ getInstallLogSourceLabel(installLogMeta?.source) }}</span>
            <span class="ml-4">状态：{{ getInstallLogStatusLabel(installLogMeta?.status) }}</span>
            <span class="ml-4">更新时间：{{ formatDateTime(installLogMeta?.updatedAt || null) }}</span>
          </p>
          <p v-if="installLogMeta?.source === 'status_summary'" class="text-amber-600 dark:text-amber-400">
            以下为最近状态摘要，不是完整 SteamCMD 输出；安装进行中请保持弹窗打开以自动刷新。
          </p>
          <p v-else-if="shouldPollInstallLog()" class="text-sky-600 dark:text-sky-400">
            安装进行中，每 3 秒自动刷新日志。
          </p>
        </div>
        <NSpin :show="installLogLoading">
          <NLog :rows="16" :log="installLogContent" trim />
        </NSpin>
      </div>
      <template #footer>
        <NSpace justify="end">
          <NButton :loading="installLogLoading" @click="fetchInstallLogContent()">
            刷新
          </NButton>
          <NButton @click="installLogVisible = false">
            关闭
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </FaPageMain>
</template>

<style scoped>
.instance-table-shell {
  min-height: 20rem;
  overflow-x: auto;
}

.filter-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.filter-field {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
}

.filter-select {
  flex: 1;
  min-width: 0;
}

.create-instance-btn {
  width: 100%;
}

@media (width >= 768px) {
  .filter-toolbar {
    display: flex;
    flex-flow: row wrap;
    align-items: center;
  }

  .filter-field {
    width: auto;
  }

  .filter-select {
    flex: none;
    width: 13rem;
  }

  .create-instance-btn {
    width: auto;
    margin-left: auto;
  }
}
</style>
