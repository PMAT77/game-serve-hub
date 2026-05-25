<script setup lang="ts">
import type { DataTableColumns, FormInst, FormRules } from 'naive-ui'
import type { CreateInstancePayload, InstallableGameItem, InstanceInstallLogPayload, InstanceItem, InstanceRuntimeMetrics, InstanceStatus, InstanceUpdateCheckJobPayload } from '@/api/modules/instance'
import type { NodeListItem } from '@/api/modules/node'
import type { NotificationReactive } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { NButton, NCheckbox, NDropdown, NProgress, NTag, useDialog, useNotification } from 'naive-ui'
import { computed, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRefs, watch } from 'vue'
import apiCluster from '@/api/modules/cluster'
import apiInstance from '@/api/modules/instance'
import apiShard from '@/api/modules/shard'
import { instanceSupportsDstRoom } from '@/composables/useGameInstance'
import {
  routeToDstRoomSettings,
  routeToDstWorldSettings,
  routeToInstanceConsole,
} from '@/navigation/game-routes'
import { blurFocusedElement } from '@/utils'
import {
  formatPortConflictDetail,
  getPortConflictDialogLabels,
  isInstancePortConflictError,
  type InstancePortConflictAction,
} from '@/utils/instancePortConflict'
import {
  tryNotifyHostMemoryPressure,
} from '@/utils/hostMemoryPressure'
import {
  blocksDefaultStart,
  buildInstanceStartGuideContext,
  buildStartGuideParagraphs,
  buildStartGuidePositiveText,
  buildStartGuideTitle,
  setStartGuideSkipped,
  shouldOfferStartGuide,
  type InstanceStartGuideContext,
} from '../instanceStartGuide'
import {
  canOpenInstallLog,
  computeUptimeSecondsFromStartedAt,
  extractInstallProgressPercent,
  formatMemoryMb,
  formatPollIntervalHint,
  formatUptime,
  getInstallLogSourceLabel,
  getInstallLogStatusLabel,
  getStatusBadgeClass,
  getStatusLabel,
  isInstanceInstallingStatus,
  shouldShowInstallDetail,
} from '../instanceDisplay'
import { formatInstallLogForDisplay } from '../installLogFormat'
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
const notification = useNotification()
const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const isMobileMode = computed(() => appSettingsStore.mode === 'mobile')

const instanceLoading = ref(false)
const updateCheckLoading = ref(false)
const UPDATE_CHECK_POLL_MS = 2000
const UPDATE_CHECK_POLL_MAX_ATTEMPTS = 45
const createLoading = ref(false)
const actionLoadingId = ref('')
const instances = ref<InstanceItem[]>([])
const instanceMetrics = ref<Record<string, InstanceRuntimeMetrics | null>>({})
const uptimeNowMs = ref(Date.now())

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
const installLogViewportRef = ref<HTMLElement | null>(null)
const formattedInstallLogContent = computed(() => formatInstallLogForDisplay(installLogContent.value))
let installLogPollTimer: ReturnType<typeof setInterval> | undefined
let metricsPollingTimer: ReturnType<typeof setInterval> | undefined
let uptimeTickTimer: ReturnType<typeof setInterval> | undefined
/** 安装结束后的列表/版本刷新去重，避免 watch、日志轮询与列表边沿重复触发 */
let installTerminalRefreshInFlight: Promise<void> | null = null
/** 曾处于安装中的实例，用于在列表刷新后补发完成/失败提示 */
const installNotifyPendingIds = new Set<string>()

// --- 常量 ---
/** 列宽总和，启用横向滚动，避免中间列被挤压为 0（操作列移动端收拢为「更多」） */
const INSTANCE_TABLE_SCROLL_X = computed(() => (isMobileMode.value ? 1210 : 1542))
const INSTANCE_INSTALL_POLL_MS = 1000
const INSTANCE_INSTALL_LOG_POLL_MS = 1000
const INSTANCE_METRICS_POLL_MS = 5000
/** 用户手动关闭通知后记录签名，避免同一批更新反复弹出 */
const UPDATE_NOTIFY_DISMISSED_KEY = 'gsh-instance-update-dismissed'
/** @deprecated 旧版在弹出 toast 时即写入，会阻止通知显示，挂载时清理 */
const UPDATE_NOTIFY_STORAGE_KEY_LEGACY = 'gsh-instance-update-notified'

const STAT_CARDS = [
  { key: 'total' as const, label: '实例总数', valueClass: 'text-lg font-semibold' },
  { key: 'running' as const, label: '运行中', valueClass: 'text-lg font-semibold text-emerald-600 dark:text-emerald-400' },
  { key: 'stopped' as const, label: '已停止', valueClass: 'text-lg font-semibold text-slate-600 dark:text-slate-300' },
  { key: 'error' as const, label: '异常', valueClass: 'text-lg font-semibold text-red-600 dark:text-red-400' },
]

const instanceUpdateNotificationRef = ref<NotificationReactive | null>(null)
/** 当前已展示通知对应的签名，避免轮询刷新列表时反复销毁/重建 */
const instanceUpdateNotifySignature = ref<string | null>(null)

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

/** 按状态单次遍历统计实例数量 */
const statusCount = computed(() => {
  const counts = {
    total: 0,
    pendingInstall: 0,
    running: 0,
    stopped: 0,
    installing: 0,
    error: 0,
  }
  for (const item of instances.value) {
    counts.total++
    switch (item.status) {
      case 'pending_install':
        counts.pendingInstall++
        break
      case 'running':
        counts.running++
        break
      case 'stopped':
        counts.stopped++
        break
      case 'installing':
        counts.installing++
        break
      case 'error':
        counts.error++
        break
    }
  }
  return counts
})

const instancesWithUpdate = computed(() =>
  instances.value.filter(item => item.updateAvailable),
)

/** 安装日志弹窗顶部辅助提示 */
const installLogHint = computed(() => {
  if (installLogMeta.value?.source === 'status_summary') {
    return {
      class: 'text-amber-600 dark:text-amber-400',
      text: '以下为最近状态摘要，不是完整安装日志；安装进行中请保持弹窗打开以自动刷新。',
    }
  }
  if (shouldPollInstallLog()) {
    const interval = formatPollIntervalHint(INSTANCE_INSTALL_LOG_POLL_MS)
    return {
      class: 'text-sky-600 dark:text-sky-400',
      text: `安装进行中，${interval}自动刷新日志。`,
    }
  }
  return null
})

const instanceColumns = computed<DataTableColumns<InstanceItem>>(() => {
  return [
    {
      title: '实例名称',
      key: 'name',
      width: 200,
      render: (row) => {
        const children = [h('span', row.name)]
        if (row.updateAvailable) {
          children.push(
            h(NTag, { type: 'warning', size: 'small', round: true }, { default: () => '有新版本' }),
          )
        }
        return h('div', { class: 'flex flex-wrap items-center gap-2' }, children)
      },
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
      title: 'CPU',
      key: 'cpu',
      width: 90,
      render: row => renderInstanceCpuColumn(row),
    },
    {
      title: '内存',
      key: 'memory',
      width: 100,
      render: row => renderInstanceMemoryColumn(row),
    },
    {
      title: '运行时长',
      key: 'uptime',
      width: 110,
      render: row => renderInstanceUptimeColumn(row),
    },
    {
      title: '安装',
      key: 'install',
      width: 132,
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
            title: canOpen ? '查看安装日志' : '暂无安装日志',
            onClick: () => openInstallLogModal(row),
          },
          { default: () => '查看日志' },
        )
      },
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 180,
      render: row => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      key: 'actions',
      width: isMobileMode.value ? 88 : 420,
      fixed: 'right',
      render: row => renderInstanceRowActions(row),
    },
  ]
})

watch(nodes, (list) => {
  if (!createForm.nodeId && list.length > 0) {
    createForm.nodeId = list[0].id
  }
}, { immediate: true })

/** 数据表行唯一键 */
function getInstanceRowKey(row: InstanceItem) {
  return row.id
}

interface InstanceRowAction {
  key: string
  label: string
  disabled?: boolean
  loading?: boolean
  title?: string
  type?: 'default' | 'error'
  onClick: () => void
}

function buildInstanceRowActions(row: InstanceItem): InstanceRowAction[] {
  const stopAction = row.status === 'installing' || row.status === 'pending_install' ? 'cancel_install' : 'stop'
  const stopLabel = stopAction === 'cancel_install' ? '取消安装' : '停止'
  return [
    {
      key: 'room',
      label: '房间设置',
      disabled: row.status === 'pending_install' || !instanceSupportsDstRoom(row),
      title: !instanceSupportsDstRoom(row) ? '当前仅 DST 实例支持房间配置' : undefined,
      onClick: () => router.push(routeToDstRoomSettings(row.id)),
    },
    {
      key: 'console',
      label: '控制台',
      disabled: row.status === 'pending_install' || row.status === 'installing',
      onClick: () => router.push(routeToInstanceConsole(row.id)),
    },
    {
      key: 'update',
      label: '更新服务端',
      loading: isActionLoading(row.id, 'update'),
      disabled: !canUpdateInstance(row),
      title: getUpdateInstanceButtonTitle(row),
      onClick: () => confirmUpdateInstance(row),
    },
    {
      key: 'start',
      label: '启动',
      loading: isActionLoading(row.id, 'start'),
      disabled: row.status === 'running' || row.status === 'pending_install' || row.status === 'installing',
      onClick: () => confirmStartInstance(row),
    },
    {
      key: 'stop',
      label: stopLabel,
      loading: isActionLoading(row.id, 'stop'),
      disabled: row.status === 'stopped' || row.status === 'error',
      onClick: () => confirmDangerousInstanceAction(row, stopAction),
    },
    {
      key: 'restart',
      label: '重启',
      loading: isActionLoading(row.id, 'restart'),
      disabled: row.status === 'pending_install' || row.status === 'installing',
      onClick: () => confirmDangerousInstanceAction(row, 'restart'),
    },
    {
      key: 'delete',
      label: '删除',
      type: 'error',
      disabled: row.status === 'pending_install' || row.status === 'installing',
      onClick: () => confirmDangerousInstanceAction(row, 'delete'),
    },
  ]
}

function renderInstanceRowActions(row: InstanceItem) {
  const actions = buildInstanceRowActions(row)
  if (!isMobileMode.value) {
    return h(
      'div',
      { class: 'flex flex-wrap gap-4' },
      actions.map(action => createTextActionButton(action)),
    )
  }

  const options: DropdownOption[] = actions.map((action) => {
    const option: DropdownOption = {
      label: action.loading ? `${action.label}…` : action.label,
      key: action.key,
      disabled: Boolean(action.disabled || action.loading),
    }
    if (action.type === 'error') {
      option.props = { class: 'text-red-600 dark:text-red-400' }
    }
    return option
  })

  const hasLoading = actions.some(action => action.loading)

  return h(
    NDropdown,
    {
      trigger: 'click',
      options,
      onSelect: (key: string) => {
        const action = actions.find(item => item.key === key)
        if (!action || action.disabled || action.loading) {
          return
        }
        action.onClick()
      },
    },
    {
      default: () => h(
        NButton,
        {
          size: 'small',
          secondary: true,
          loading: hasLoading,
        },
        { default: () => '更多' },
      ),
    },
  )
}

/** 渲染表格操作列中的文本按钮 */
function createTextActionButton(options: {
  label: string
  disabled?: boolean
  loading?: boolean
  title?: string
  type?: 'default' | 'error'
  onClick: () => void
}) {
  return h(
    NButton,
    {
      size: 'small',
      text: true,
      type: options.type,
      disabled: options.disabled,
      loading: options.loading,
      title: options.title,
      onClick: options.onClick,
    },
    { default: () => options.label },
  )
}

/** 渲染安装列：安装中显示进度条（随列表轮询更新） */
function renderInstallColumn(instance: InstanceItem) {
  if (instance.status === 'running' || instance.status === 'stopped') {
    return h('span', { class: 'text-sm text-muted-foreground' }, '已安装')
  }
  if (instance.status === 'error') {
    return h('span', { class: 'text-sm text-red-500' }, '安装失败')
  }
  if (!shouldShowInstallDetail(instance)) {
    return h('span', { class: 'text-sm text-muted-foreground' }, '—')
  }

  const progress = extractInstallProgressPercent(instance)
  const isActiveInstall = instance.status === 'installing' || instance.status === 'pending_install'

  if (isActiveInstall || progress !== null) {
    const percentage = progress ?? 0
    return h('div', { class: 'w-full min-w-0 max-w-full box-border' }, [
      h(NProgress, {
        percentage,
        height: 10,
        showIndicator: false,
        processing: isActiveInstall && (progress === null || progress < 100),
        borderRadius: 4,
        class: 'w-full',
      }), 
    ])
  }

  return h('span', { class: 'text-sm text-muted-foreground' }, '—')
}

/** 根据节点 ID 解析节点名称 */
function getNodeName(nodeId: string) {
  return nodes.value.find(node => node.id === nodeId)?.name ?? nodeId
}

function formatCpuPercent(rate: number | null | undefined) {
  if (rate === null || typeof rate === 'undefined' || !Number.isFinite(rate)) {
    return '—'
  }
  return `${rate.toFixed(1)}%`
}

function getMetricsForInstance(instanceId: string) {
  return instanceMetrics.value[instanceId] ?? null
}

function renderRuntimePlaceholder() {
  return h('span', { class: 'text-sm text-muted-foreground' }, '—')
}

function renderInstanceCpuColumn(row: InstanceItem) {
  if (row.status !== 'running') {
    return renderRuntimePlaceholder()
  }
  const metrics = getMetricsForInstance(row.id)
  if (metrics?.cpuUsageRate === null || typeof metrics?.cpuUsageRate === 'undefined') {
    return renderRuntimePlaceholder()
  }
  return h(
    'span',
    {
      class: 'text-sm',
      title: '进程 CPU 占用（非整机）',
    },
    formatCpuPercent(metrics.cpuUsageRate),
  )
}

function renderInstanceMemoryColumn(row: InstanceItem) {
  if (row.status !== 'running') {
    return renderRuntimePlaceholder()
  }
  const metrics = getMetricsForInstance(row.id)
  return h(
    'span',
    {
      class: 'text-sm',
      title: '进程常驻内存（RSS）',
    },
    formatMemoryMb(metrics?.memoryMb),
  )
}

function getUptimeSecondsForRow(row: InstanceItem) {
  if (row.status !== 'running') {
    return null
  }
  const fromStarted = computeUptimeSecondsFromStartedAt(row.runtimeStartedAt, uptimeNowMs.value)
  if (fromStarted !== null) {
    return fromStarted
  }
  return getMetricsForInstance(row.id)?.uptimeSeconds ?? null
}

function renderInstanceUptimeColumn(row: InstanceItem) {
  if (row.status !== 'running') {
    return renderRuntimePlaceholder()
  }
  return h(
    'span',
    {
      class: 'text-sm',
      title: '自本次启动以来的运行时长',
    },
    formatUptime(getUptimeSecondsForRow(row)),
  )
}

function stopMetricsPolling() {
  if (metricsPollingTimer) {
    clearInterval(metricsPollingTimer)
    metricsPollingTimer = undefined
  }
}

function stopUptimeTick() {
  if (uptimeTickTimer) {
    clearInterval(uptimeTickTimer)
    uptimeTickTimer = undefined
  }
}

function syncRuntimeObservabilityPolling() {
  const hasRunning = instances.value.some(item => item.status === 'running')
  if (!hasRunning) {
    stopMetricsPolling()
    stopUptimeTick()
    instanceMetrics.value = {}
    return
  }
  uptimeNowMs.value = Date.now()
  if (!metricsPollingTimer) {
    void fetchInstanceMetrics({ silent: true })
    metricsPollingTimer = setInterval(() => {
      if (!instances.value.some(item => item.status === 'running')) {
        syncRuntimeObservabilityPolling()
        return
      }
      void fetchInstanceMetrics({ silent: true })
    }, INSTANCE_METRICS_POLL_MS)
  }
  if (!uptimeTickTimer) {
    uptimeTickTimer = setInterval(() => {
      uptimeNowMs.value = Date.now()
      if (!instances.value.some(item => item.status === 'running')) {
        syncRuntimeObservabilityPolling()
      }
    }, 1000)
  }
}

async function fetchInstanceMetrics(options?: { silent?: boolean }) {
  const runningIds = instances.value
    .filter(item => item.status === 'running')
    .map(item => item.id)
  if (runningIds.length === 0) {
    instanceMetrics.value = {}
    return
  }
  try {
    const res = await apiInstance.getInstanceMetrics(runningIds)
    instanceMetrics.value = res.data.items
  }
  catch {
    if (!options?.silent) {
      faToast.error('实例资源指标刷新失败')
    }
  }
}

/** 是否已检查且为最新版本 */
function isInstanceUpToDate(instance: InstanceItem) {
  return Boolean(
    instance.updateCheckedAt
    && instance.localBuildId
    && instance.remoteBuildId
    && !instance.updateAvailable,
  )
}

/** 是否允许点击「更新服务端」 */
function canUpdateInstance(instance: InstanceItem) {
  if (instance.status === 'running') {
    return false
  }
  if (instance.status === 'pending_install' || instance.status === 'installing') {
    return false
  }
  if (instance.status === 'error') {
    return true
  }
  if (!instance.localBuildId) {
    return true
  }
  if (instance.updateAvailable) {
    return true
  }
  return instance.status === 'stopped' && !isInstanceUpToDate(instance)
}

/** 「更新服务端」按钮禁用时的 tooltip */
function getUpdateInstanceButtonTitle(instance: InstanceItem) {
  if (instance.status === 'running') {
    return '请先停止实例'
  }
  if (instance.status === 'pending_install' || instance.status === 'installing') {
    return '安装进行中'
  }
  if (instance.status === 'error') {
    return '实例异常，点击重新拉取服务端文件'
  }
  if (!instance.localBuildId) {
    return '尚未检测到本地服务端文件，点击拉取安装'
  }
  if (isInstanceUpToDate(instance)) {
    return `已是最新版本（Build ${instance.localBuildId}）`
  }
  return '拉取最新游戏服务端'
}

function confirmUpdateInstance(row: InstanceItem) {
  blurFocusedElement()
  dialog.warning({
    title: '确认更新服务端',
    content: `将拉取「${row.name}」的最新游戏服务端文件。更新前请确保实例已停止，过程可在「查看日志」中查看进度。`,
    positiveText: '开始更新',
    negativeText: '取消',
    positiveButtonProps: {
      type: 'warning',
    },
    onPositiveClick: () => {
      void runUpdateInstance(row)
    },
  })
}

function suppressInstanceUpdateNotificationForCurrentBatch() {
  const signature = buildUpdateNotifySignature(instances.value)
  if (signature) {
    sessionStorage.setItem(UPDATE_NOTIFY_DISMISSED_KEY, signature)
  }
  dismissInstanceUpdateNotification()
}

async function runUpdateInstance(row: InstanceItem) {
  suppressInstanceUpdateNotificationForCurrentBatch()
  actionLoadingId.value = `update:${row.id}`
  try {
    await apiInstance.updateInstance(row.id, { force: row.status === 'error' || !row.localBuildId })
    faToast.success('已开始更新服务端，请查看安装日志了解进度')
    await fetchInstances()
    await openInstallLogModal(row)
  }
  catch (error) {
    if (tryNotifyHostMemoryPressure(notification, error)) {
      await fetchInstances()
      return
    }
    await fetchInstances()
  }
  finally {
    actionLoadingId.value = ''
  }
}

function confirmDangerousInstanceAction(row: InstanceItem, action: 'stop' | 'cancel_install' | 'restart' | 'delete') {
  blurFocusedElement()
  const actionConfig = {
    stop: {
      title: '确认停止',
      content: `确认停止实例「${row.name}」吗？`,
      positiveText: '停止',
      type: 'warning' as const,
    },
    cancel_install: {
      title: '确认取消安装',
      content: `将中断「${row.name}」的安装，实例将标记为异常。可查看安装日志后删除并重新创建。`,
      positiveText: '取消安装',
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
      void runInstanceAction(row.id, action === 'cancel_install' ? 'stop' : action)
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
  blurFocusedElement()
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

/** 安装日志视口是否已贴底（用于判断是否跟随新日志自动滚动） */
const INSTALL_LOG_AT_BOTTOM_THRESHOLD_PX = 24

function isInstallLogViewportAtBottom(el: HTMLElement) {
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  return distanceFromBottom <= INSTALL_LOG_AT_BOTTOM_THRESHOLD_PX
}

/** 更新前已贴底时，写入新内容后滚动到底部 */
function scrollInstallLogToBottomIfNeeded(wasAtBottom: boolean) {
  if (!installLogVisible.value || !wasAtBottom) {
    return
  }
  nextTick(() => {
    const el = installLogViewportRef.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

/** 当前目标实例是否仍需轮询安装日志 */
function shouldPollInstallLog() {
  if (!installLogTargetId.value) {
    return false
  }
  const row = instances.value.find(item => item.id === installLogTargetId.value)
  return isInstanceInstallingStatus(row?.status)
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
    const viewport = installLogViewportRef.value
    const wasAtBottom = !viewport || isInstallLogViewportAtBottom(viewport)
    installLogMeta.value = res.data
    installLogContent.value = res.data.content || '暂无安装日志'
    scrollInstallLogToBottomIfNeeded(wasAtBottom)
  }
  finally {
    if (!options?.silent) {
      installLogLoading.value = false
    }
  }
}

/** 安装/更新结束后是否应检查 Steam 远端版本（仅成功且已停止） */
function shouldCheckVersionAfterInstall(instanceId: string) {
  if (!steamcmdInstalled.value) {
    return false
  }
  if (installLogTargetId.value === instanceId && installLogMeta.value?.status === 'failed') {
    return false
  }
  const row = instances.value.find(item => item.id === instanceId)
  return row?.status === 'stopped'
}

/** 安装结束后立即刷新列表（成功或失败），不阻塞于版本检查 */
async function refreshInstancesAfterInstallTerminal() {
  try {
    const res = await apiInstance.getInstanceList({
      nodeId: selectedNodeId.value !== 'all' ? selectedNodeId.value : undefined,
      keyword: keywordFilter.value.trim() || undefined,
    })
    syncInstallTerminalNotifications(res.data)
  }
  catch {
    // 提示补发失败不阻断列表刷新
  }
  await fetchInstances({ silent: true })
}

/** 安装成功后同步 Build ID 与更新通知（后台执行，不阻塞 UI） */
async function refreshVersionStatusAfterSuccessfulInstall(instanceId: string) {
  if (!shouldCheckVersionAfterInstall(instanceId)) {
    return
  }
  void apiInstance.checkInstanceUpdates([instanceId]).catch(() => {})
  await fetchInstances({ silent: true })
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function waitForInstanceUpdateCheckJob(): Promise<InstanceUpdateCheckJobPayload> {
  for (let attempt = 0; attempt < UPDATE_CHECK_POLL_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(UPDATE_CHECK_POLL_MS)
    }
    const res = await apiInstance.getInstanceUpdateCheckStatus()
    if (!res.data.checking) {
      return res.data
    }
  }
  throw new Error('版本检查超时，请稍后重试')
}

function notifyInstanceUpdateCheckResult(status: InstanceUpdateCheckJobPayload) {
  if (status.error) {
    faToast.error(status.error)
    return
  }
  const updateAvailableCount = status.result?.updateAvailableCount ?? 0
  if (updateAvailableCount === 0) {
    faToast.success('已全部是最新版本')
    return
  }
  faToast.info(`有 ${updateAvailableCount} 个实例可更新`)
}

/** 安装结束统一入口：先刷新列表，成功时再检查版本（去重） */
function handleInstallTerminal(preferredInstanceId?: string) {
  if (installTerminalRefreshInFlight) {
    return installTerminalRefreshInFlight
  }
  installTerminalRefreshInFlight = (async () => {
    const instanceId = preferredInstanceId?.trim() || installLogTargetId.value || undefined
    await refreshInstancesAfterInstallTerminal()
    if (instanceId) {
      await refreshVersionStatusAfterSuccessfulInstall(instanceId)
    }
  })().finally(() => {
    installTerminalRefreshInFlight = null
  })
  return installTerminalRefreshInFlight
}

/** 在弹窗打开且实例安装中时启动日志轮询 */
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
      void handleInstallTerminal(installLogTargetId.value)
    }
  }, INSTANCE_INSTALL_LOG_POLL_MS)
}

async function openInstallLogModal(instance: InstanceItem) {
  blurFocusedElement()
  installLogTargetId.value = instance.id
  installLogInstanceName.value = instance.name
  installLogVisible.value = true
  installLogContent.value = ''
  installLogMeta.value = null
  await fetchInstallLogContent()
  startInstallLogPolling()
}

/** 关闭安装日志弹窗并停止轮询 */
function closeInstallLogModal() {
  installLogVisible.value = false
  stopInstallLogPolling()
}

function buildUpdateNotifySignature(list: InstanceItem[]) {
  return list
    .filter(item => item.updateAvailable)
    .map(item => `${item.id}:${item.remoteBuildId ?? ''}`)
    .sort()
    .join('|')
}

/** 关闭版本更新全局通知 */
function dismissInstanceUpdateNotification() {
  instanceUpdateNotificationRef.value?.destroy()
  instanceUpdateNotificationRef.value = null
  instanceUpdateNotifySignature.value = null
}

/** 同步「有新版本」全局通知（尊重用户手动关闭记录） */
function syncInstanceUpdateNotification(pending: InstanceItem[]) {
  if (pending.length === 0) {
    dismissInstanceUpdateNotification()
    return
  }
  const signature = buildUpdateNotifySignature(instances.value)
  if (!signature) {
    return
  }
  if (sessionStorage.getItem(UPDATE_NOTIFY_DISMISSED_KEY) === signature) {
    dismissInstanceUpdateNotification()
    return
  }
  if (instances.value.some(item => isInstanceInstallingStatus(item.status))) {
    dismissInstanceUpdateNotification()
    return
  }
  if (instanceUpdateNotificationRef.value && instanceUpdateNotifySignature.value === signature) {
    return
  }
  const names = pending.map(item => item.name).join('、')
  dismissInstanceUpdateNotification()
  instanceUpdateNotifySignature.value = signature
  instanceUpdateNotificationRef.value = notification.warning({
    title: '发现游戏服务端新版本',
    content: `${names} 在 Steam 上有新版本。请先停止实例，使用「更新服务端」拉取最新文件后再启动。`,
    duration: 0,
    closable: true,
    onClose: () => {
      sessionStorage.setItem(UPDATE_NOTIFY_DISMISSED_KEY, signature)
      dismissInstanceUpdateNotification()
    },
  })
}

watch(
  instancesWithUpdate,
  pending => syncInstanceUpdateNotification(pending),
  { deep: true, immediate: true },
)

watch(
  () => installLogMeta.value?.status,
  (status, previous) => {
    if (previous === 'running' && (status === 'success' || status === 'failed')) {
      void handleInstallTerminal(installLogTargetId.value)
    }
  },
)

/** 记录安装中实例，并在其离开安装态后提示结果 */
function syncInstallTerminalNotifications(list: InstanceItem[]) {
  for (const item of list) {
    if (isInstanceInstallingStatus(item.status)) {
      installNotifyPendingIds.add(item.id)
    }
  }
  for (const id of [...installNotifyPendingIds]) {
    const row = list.find(item => item.id === id)
    if (!row) {
      installNotifyPendingIds.delete(id)
      continue
    }
    if (isInstanceInstallingStatus(row.status)) {
      continue
    }
    installNotifyPendingIds.delete(id)
    if (row.status === 'stopped') {
      faToast.success(`「${row.name}」安装完成，可以启动实例`)
    }
    else if (row.status === 'error') {
      faToast.error(`「${row.name}」安装失败，请查看安装日志`)
    }
  }
}

/** 按当前筛选条件拉取实例列表 */
async function fetchInstances(options?: { silent?: boolean }) {
  if (!options?.silent) {
    instanceLoading.value = true
  }
  try {
    const res = await apiInstance.getInstanceList({
      nodeId: selectedNodeId.value !== 'all' ? selectedNodeId.value : undefined,
      status: statusFilter.value !== 'all' ? statusFilter.value : undefined,
      keyword: keywordFilter.value.trim() || undefined,
    })
    instances.value = res.data
    syncInstallTerminalNotifications(instances.value)
    syncRuntimeObservabilityPolling()
  }
  finally {
    if (!options?.silent) {
      instanceLoading.value = false
    }
  }
}

/** 关键词搜索：触发列表刷新 */
async function searchInstances() {
  await fetchInstances()
}

async function checkAllInstanceUpdates() {
  if (!steamcmdInstalled.value) {
    faToast.error('请先拉取游戏安装镜像（见上方容器镜像面板）')
    return
  }
  if (instances.value.length === 0) {
    return
  }
  updateCheckLoading.value = true
  faToast.info('版本检查已在后台进行，约需半分钟，完成后自动刷新', {
    duration: 6000,
  })
  try {
    const startRes = await apiInstance.checkInstanceUpdates()
    const finalStatus = startRes.data.checking
      ? await waitForInstanceUpdateCheckJob()
      : startRes.data
    await fetchInstances()
    notifyInstanceUpdateCheckResult(finalStatus)
  }
  catch (error) {
    faToast.error(error instanceof Error ? error.message : '版本检查失败，请稍后重试')
  }
  finally {
    updateCheckLoading.value = false
  }
}

async function refreshInstancesAndResetKeyword() {
  keywordFilter.value = ''
  await fetchInstances()
}

async function createInstance() {
  if (!steamcmdInstalled.value) {
    faToast.error('请先拉取游戏安装镜像，再创建实例')
    return
  }
  if (!steamcmdConfigured.value) {
    faToast.error('容器运行时未就绪，请检查 Docker 与实例数据目录配置')
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
  catch (error) {
    if (tryNotifyHostMemoryPressure(notification, error)) {
      return
    }
  }
  finally {
    createLoading.value = false
  }
}

function renderStartGuideContent(
  ctx: InstanceStartGuideContext,
  instanceId: string,
  dontShowAgainRef: { value: boolean },
) {
  const paragraphs = buildStartGuideParagraphs(ctx)
  const children: ReturnType<typeof h>[] = paragraphs.map(text =>
    h('p', { class: 'text-sm leading-relaxed text-foreground' }, text),
  )

  if (!blocksDefaultStart(ctx)) {
    children.push(
      h('div', { class: 'flex flex-wrap gap-2 pt-1' }, [
        h(
          NButton,
          {
            size: 'small',
            tertiary: true,
            onClick: () => {
              dialog.destroyAll()
              router.push(routeToDstRoomSettings(instanceId))
            },
          },
          { default: () => '先去配置房间' },
        ),
        h(
          NButton,
          {
            size: 'small',
            tertiary: true,
            onClick: () => {
              dialog.destroyAll()
              router.push(routeToDstWorldSettings(instanceId))
            },
          },
          { default: () => '先去配置世界' },
        ),
      ]),
      h(NCheckbox, {
        checked: dontShowAgainRef.value,
        'onUpdate:checked': (v: boolean) => {
          dontShowAgainRef.value = v
        },
      }, { default: () => '下次启动不再提示' }),
    )
  }

  return h('div', { class: 'space-y-3 max-w-prose' }, children)
}

async function confirmStartInstance(row: InstanceItem) {
  blurFocusedElement()

  const quickStart = () => runInstanceAction(row.id, 'start')

  if (!shouldOfferStartGuide(row, undefined)) {
    await quickStart()
    return
  }

  let guideContext: InstanceStartGuideContext
  try {
    const [clusterRes, shardRes] = await Promise.all([
      apiCluster.getClusterConfig(row.id),
      apiShard.getShardList(row.id),
    ])
    const master = shardRes.data.shards.find(s => s.id === 'master')
    if (!shouldOfferStartGuide(row, master?.worldGenerated)) {
      await quickStart()
      return
    }
    guideContext = buildInstanceStartGuideContext(row, clusterRes.data, shardRes.data)
  }
  catch {
    faToast.error('暂时无法读取房间与世界配置，请稍后再试')
    return
  }

  const dontShowAgain = { value: false }
  const publicBlocked = blocksDefaultStart(guideContext)

  dialog.warning({
    title: buildStartGuideTitle(),
    content: () => renderStartGuideContent(guideContext, row.id, dontShowAgain),
    positiveText: buildStartGuidePositiveText(guideContext),
    negativeText: '取消',
    onPositiveClick: () => {
      if (dontShowAgain.value) {
        setStartGuideSkipped(row.id)
      }
      if (publicBlocked) {
        router.push(routeToDstRoomSettings(row.id))
        return
      }
      return quickStart()
    },
  })
}

function showInstancePortConflictDialog(
  instanceId: string,
  action: InstancePortConflictAction,
  payload: { error: string, data?: { conflictingPorts?: number[], suggestedGamePort?: number | null } },
  onAutoResolve?: () => void | Promise<void>,
) {
  const labels = getPortConflictDialogLabels(action)
  const detail = formatPortConflictDetail(payload.data ?? {})
  dialog.warning({
    title: labels.title,
    content: () => h('div', { class: 'space-y-2 max-w-prose text-sm' }, [
      h('p', payload.error),
      h('p', { class: 'text-muted-foreground' }, detail),
    ]),
    positiveText: labels.positiveText,
    negativeText: '自行配置',
    onPositiveClick: () => onAutoResolve?.(),
    onNegativeClick: () => {
      router.push(routeToDstWorldSettings(instanceId, { tab: 'network' }))
    },
  })
}

function describeInstanceActionError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error && 'error' in error) {
    return String((error as { error?: string }).error)
  }
  return fallback
}

async function runInstanceLifecycleWithPortHandling(
  instanceId: string,
  action: InstancePortConflictAction,
  options?: { autoAllocatePorts?: boolean },
) {
  const labels = getPortConflictDialogLabels(action)
  const apiCall = action === 'restart'
    ? () => apiInstance.restartInstance(instanceId, { autoAllocatePorts: options?.autoAllocatePorts })
    : () => apiInstance.startInstance(instanceId, { autoAllocatePorts: options?.autoAllocatePorts })

  try {
    await apiCall()
    faToast.success(labels.successToast)
    await fetchInstances()
  }
  catch (error) {
    if (isInstancePortConflictError(error)) {
      showInstancePortConflictDialog(instanceId, action, error, () => runInstanceLifecycleWithPortHandling(instanceId, action, {
        autoAllocatePorts: true,
      }))
      return
    }
    if (tryNotifyHostMemoryPressure(notification, error)) {
      return
    }
    faToast.error(action === 'restart' ? '重启失败' : '启动失败', {
      description: describeInstanceActionError(error, '请稍后重试'),
    })
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
      await runInstanceLifecycleWithPortHandling(instanceId, 'start')
      return
    }
    if (action === 'restart') {
      await runInstanceLifecycleWithPortHandling(instanceId, 'restart')
      return
    }
    if (action === 'stop') {
      await apiInstance.stopInstance(instanceId)
      faToast.success('实例已停止')
    }
    else {
      await apiInstance.deleteInstance(instanceId)
      faToast.success('实例已删除')
    }
    await fetchInstances()
  }
  catch (error) {
    if (action !== 'start' && action !== 'restart') {
      faToast.error('操作失败', {
        description: describeInstanceActionError(error, '请稍后重试'),
      })
    }
  }
  finally {
    if (useTableLoading) {
      actionLoadingId.value = ''
    }
  }
}

/** 操作按钮是否处于 loading（格式 action:instanceId） */
function isActionLoading(instanceId: string, action: 'start' | 'stop' | 'restart' | 'delete' | 'update') {
  return actionLoadingId.value === `${action}:${instanceId}`
}

onMounted(async () => {
  sessionStorage.removeItem(UPDATE_NOTIFY_STORAGE_KEY_LEGACY)
  await Promise.all([
    fetchInstallableGames(),
    fetchInstances(),
  ])
  void fetchInstanceMetrics({ silent: true })
})

let hadInstallingInstance = false
const instancePollingTimer = setInterval(() => {
  const hasInstalling = instances.value.some(item => isInstanceInstallingStatus(item.status))
  if (hasInstalling) {
    hadInstallingInstance = true
    void fetchInstances({ silent: true })
    return
  }
  if (hadInstallingInstance) {
    hadInstallingInstance = false
    void handleInstallTerminal()
  }
}, INSTANCE_INSTALL_POLL_MS)

onBeforeUnmount(() => {
  clearInterval(instancePollingTimer)
  stopInstallLogPolling()
  stopMetricsPolling()
  stopUptimeTick()
  dismissInstanceUpdateNotification()
})
</script>

<template>
  <FaPageMain title="实例管理">
    <section class="p-4 border border-border rounded-xl bg-card space-y-4">
      <div class="gap-3 grid md:grid-cols-4">
        <div
          v-for="card in STAT_CARDS"
          :key="card.key"
          class="p-3 rounded-md bg-muted/40"
        >
          <p class="text-xs text-muted-foreground">
            {{ card.label }}
          </p>
          <p class="mt-1" :class="card.valueClass">
            {{ statusCount[card.key] }}
          </p>
        </div>
      </div>

      <div class="gap-3 grid">
        <div class="flex gap-2 items-center">
          <NInput
            v-model:value="keywordFilter"
            class="w-64"
            placeholder="实例名称/Steam AppID"
            @keydown.enter="searchInstances"
          />
          <NButton type="primary" strong secondary @click="searchInstances">
            查询
          </NButton>
          <NButton @click="refreshInstancesAndResetKeyword">
            重置
          </NButton>
        </div>
        <div class="flex flex-col gap-3 md:flex-row md:flex-nowrap md:items-center">
          <div class="flex w-full min-w-0 flex-col gap-3 md:w-auto md:flex-row md:shrink md:flex-initial">
            <div class="flex w-full min-w-0 items-center gap-2 md:w-44 md:flex-none">
              <label class="shrink-0 text-sm text-muted-foreground">节点：</label>
              <NSelect
                v-model:value="selectedNodeId"
                :options="nodeOptions"
                class="min-w-0 flex-1 md:w-44 md:flex-none"
                @update:value="fetchInstances"
              />
            </div>
            <div class="flex w-full min-w-0 items-center gap-2 md:w-44 md:flex-none">
              <label class="shrink-0 text-sm text-muted-foreground">状态：</label>
              <NSelect
                v-model:value="statusFilter"
                :options="statusFilterOptions"
                class="min-w-0 flex-1 md:w-44 md:flex-none"
                @update:value="fetchInstances"
              />
            </div>
          </div>
          <div class="flex gap-2 w-full md:ml-auto md:shrink-0 md:w-auto">
            <NButton
              class="flex-1 min-w-0 md:flex-none"
              type="warning"
              strong
              secondary
              :loading="updateCheckLoading"
              :disabled="!steamcmdInstalled || instances.length === 0"
              @click="checkAllInstanceUpdates"
            >
              <template #icon>
                <FaIcon name="i-ri:refresh-line" />
              </template>
              检查更新
            </NButton>
            <NButton class="flex-1 min-w-0 md:flex-none" type="primary" @click="openCreateModal">
              <template #icon>
                <FaIcon name="i-ri:add-line" />
              </template>
              创建实例
            </NButton>
          </div>
        </div>
      </div>

      <div class="min-h-80 overflow-x-auto">
        <NDataTable
          :bordered="false"
          :single-line="false"
          size="small"
          :scroll-x="INSTANCE_TABLE_SCROLL_X"
          :columns="instanceColumns"
          :data="instances"
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
          <NInput v-model:value="createForm.installPath" placeholder="默认：&lt;instancesRoot&gt;/&lt;instanceId&gt;" />
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
      :title="`安装日志 - ${installLogInstanceName || '实例'}`"
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
          <p v-if="installLogHint" :class="installLogHint.class">
            {{ installLogHint.text }}
          </p>
        </div>
        <NSpin :show="installLogLoading">
          <pre
            ref="installLogViewportRef"
            class="max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground"
          >{{ formattedInstallLogContent || '暂无安装日志' }}</pre>
        </NSpin>
      </div>
      <template #footer>
        <NSpace justify="end">
          <NButton :loading="installLogLoading" @click="fetchInstallLogContent()">
            刷新
          </NButton>
          <NButton @click="closeInstallLogModal">
            关闭
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </FaPageMain>
</template>

