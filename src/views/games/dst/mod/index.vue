<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type {
  ModInstallStatus,
  ModItemDto,
  SteamModListQueryResultItem,
  SteamModSort,
  SteamModTrendDays,
} from '@/api/modules/mod'
import type { InstanceItem } from '@/api/modules/instance'
import { useDebounceFn } from '@vueuse/core'
import type { NotificationReactive } from 'naive-ui'
import { NAlert, NButton, NCard, NDataTable, NEmpty, NImage, NInput, NPagination, NRate, NSelect, NSwitch, NTabPane, NTabs, NTag, NTooltip, useDialog, useMessage, useNotification } from 'naive-ui'
import AdminListToolbar from '@/components/AdminListToolbar.vue'
import { computed, h, onMounted, ref, shallowRef, watch } from 'vue'
import apiInstance from '@/api/modules/instance'
import apiMod from '@/api/modules/mod'
import { isInstallableGameInstance } from '@/composables/useGameInstance'
import { useInstanceModState } from '@/composables/useInstanceModState'
import ModConfigModal from '@/views/games/dst/mod/components/ModConfigModal.vue'
import { routeToDstModDetail, routeToDstWorldSettings, routeToNodeInstance } from '@/navigation/game-routes'
import { MOD_INSTALL_STATUS } from '@/constants/statusDictionary'
import { getInstanceState } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'DstModList',
})

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const notification = useNotification()
const appSettingsStore = useAppSettingsStore()
const isMobileMode = computed(() => appSettingsStore.mode === 'mobile')

/** 订阅成功引导卡：持久展示，引导用户去世界设置开启 Mod */
const subscribeGuideNotificationRef = ref<NotificationReactive | null>(null)
/** 服务端下发的 Mod 风险提示横幅（加载列表/切换开关时更新） */
const riskTipBanner = ref<string | null>(null)
/** Steam 列表加载失败原因：与空列表区分 */
const steamLoadError = ref<string | null>(null)

interface BusinessErrorLike {
  error?: string
  code?: string
}

interface SteamModMeta {
  cached: boolean
  stale: boolean
  cacheAgeMs: number
  upstreamSource: 'official' | 'relay' | 'html'
  lastSuccessSource?: 'official' | 'relay' | 'html'
  lastSuccessAt?: string
  retryAfterMs?: number
  upstreamUnavailable?: boolean
  upstreamMessage?: string
  steamErrorCode?: string
}

const loadingInstances = ref(false)
const loadingSteam = ref(false)
const loadingInstalled = ref(false)
const unsubscribingWorkshopIds = ref<Set<string>>(new Set())
const checkedRowKeys = ref<Array<string | number>>([])
const batchUpdating = ref(false)
const configModalShow = ref(false)
const configTarget = ref<{ workshopId: string, name: string } | null>(null)
const instances = ref<InstanceItem[]>([])
const selectedInstanceId = ref('')
const {
  downloadingMods,
  isPendingWorkshop,
  restoreInstallJobs,
  installMod,
  syncPendingWorkshopIds,
  resetState,
} = useInstanceModState(() => selectedInstanceId.value)
const activeTab = ref<'market' | 'subscribed'>('market')
const steamKeyword = ref('')
const steamSort = ref<SteamModSort>('trend')
const steamTrendDays = ref<SteamModTrendDays>(7)
const steamPage = ref(1)
const steamPageSize = ref(20)
const steamHasMore = ref(false)
const steamTotalCount = ref<number | null>(null)
const steamTotalPages = ref<number | null>(null)
const steamSourceUrl = ref('')
const steamMods = ref<SteamModListQueryResultItem[]>([])
const installedMods = ref<ModItemDto[]>([])
const steamMeta = ref<SteamModMeta | null>(null)
const steamUpstreamHint = ref<string | null>(null)
const steamAbortController = shallowRef<AbortController | null>(null)
const suppressSteamSortWatchUntil = ref(0)

function goToModDetail(workshopId: string) {
  if (!selectedInstanceId.value) {
    message.warning('请先选择实例')
    return
  }
  router.push(routeToDstModDetail(workshopId, selectedInstanceId.value))
}

function renderModPreview(previewImage: string | null) {
  if (!previewImage) {
    return h('div', {
      class: 'flex size-12 items-center justify-center rounded bg-muted text-xs text-muted-foreground',
    }, '无图')
  }
  return h(NImage, {
    src: previewImage,
    width: 48,
    height: 48,
    objectFit: 'cover',
    lazy: true,
    previewDisabled: false,
    class: 'rounded',
  })
}

function renderModRating(rating: number | null) {
  if (rating === null) {
    return h('span', { class: 'text-xs text-muted-foreground' }, '-')
  }
  return h(NRate, {
    readonly: true,
    allowHalf: true,
    size: 'small',
    value: rating,
  })
}

const resolvedPageCount = computed(() => {
  if (steamTotalPages.value !== null) {
    return steamTotalPages.value
  }
  if (steamTotalCount.value !== null && steamPageSize.value > 0) {
    return steamTotalCount.value === 0
      ? 0
      : Math.max(1, Math.ceil(steamTotalCount.value / steamPageSize.value))
  }
  return steamHasMore.value ? steamPage.value + 1 : steamPage.value
})

const steamPagingSummary = computed(() => {
  if (steamTotalCount.value === null && steamTotalPages.value === null) {
    return ''
  }
  const parts: string[] = []
  if (steamTotalCount.value !== null) {
    parts.push(`共 ${steamTotalCount.value} 条`)
  }
  if (resolvedPageCount.value > 0) {
    parts.push(`${resolvedPageCount.value} 页`)
  }
  return parts.join(' · ')
})

const pagination = computed(() => ({
  page: steamPage.value,
  pageSize: steamPageSize.value,
  pageCount: resolvedPageCount.value,
  itemCount: steamTotalCount.value ?? undefined,
  showSizePicker: false,
  onChange: (page: number) => {
    if (page === steamPage.value) {
      return
    }
    const maxPage = resolvedPageCount.value
    if (maxPage > 0 && (page < 1 || page > maxPage)) {
      return
    }
    if (maxPage === 0) {
      return
    }
    if (steamTotalPages.value === null && steamTotalCount.value === null && page > steamPage.value && !steamHasMore.value) {
      return
    }
    steamPage.value = page
    void loadSteamMods(false)
  },
}))

function changeSteamPage(page: number) {
  pagination.value.onChange(page)
}

const instanceOptions = computed(() => {
  return instances.value.map((instance) => {
    const state = getInstanceState(instance)
    const needsHint = !['running', 'stopped'].includes(state.key)
    return {
      label: needsHint ? `${instance.name}（${state.label}）` : instance.name,
      value: instance.id,
    }
  })
})

const isSteamTrendSort = computed(() => steamSort.value === 'trend')
const hasSteamKeyword = computed(() => Boolean(steamKeyword.value.trim()))
const hasInstallableInstances = computed(() => instances.value.length > 0)
const instanceSelectPlaceholder = computed(() => {
  if (hasInstallableInstances.value) {
    return '请选择要管理的 DST 实例'
  }
  return '暂无可管理的 DST 实例'
})
const hasSelectedInstance = computed(() => Boolean(selectedInstanceId.value))
const selectedInstanceName = computed(() =>
  instanceOptions.value.find(item => item.value === selectedInstanceId.value)?.label ?? '-',
)
const marketEmptyDescription = computed(() => {
  if (!selectedInstanceId.value) {
    return '请先选择实例'
  }
  if (steamLoadError.value) {
    return steamLoadError.value
  }
  if (steamKeyword.value.trim()) {
    return '未找到符合条件的 Mod'
  }
  return '暂无 Mod 数据'
})
const subscribedEmptyDescription = computed(() => {
  if (!selectedInstanceId.value) {
    return '请先选择实例'
  }
  if (downloadingMods.value.length > 0) {
    return '订阅的 Mod 下载中，完成后会出现在列表里'
  }
  return '暂无已订阅 Mod'
})
const subscribedTabCount = computed(() => installedMods.value.length)
const selectedUpdatableMods = computed(() =>
  installedMods.value.filter(mod =>
    checkedRowKeys.value.includes(mod.workshopId)
    && mod.installStatus !== 'pending'
    && !isPendingWorkshop(mod.workshopId),
  ),
)

function resolveMarketSubscribeStatus(row: SteamModListQueryResultItem): ModInstallStatus | null {
  if (row.subscribeStatus) {
    return row.subscribeStatus
  }
  if (row.pendingDownload || isPendingWorkshop(row.workshopId)) {
    return 'pending'
  }
  if (row.subscribed || row.installed) {
    return 'ready'
  }
  return null
}

function marketStatusLabel(row: SteamModListQueryResultItem): string {
  const status = resolveMarketSubscribeStatus(row)
  if (status === 'pending') return '下载中'
  if (status === 'failed') return '下载失败'
  if (status === 'ready') return '已订阅'
  return '未订阅'
}

function marketStatusType(row: SteamModListQueryResultItem): 'default' | 'success' | 'warning' | 'error' {
  const status = resolveMarketSubscribeStatus(row)
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'error'
  if (status === 'ready') return 'success'
  return 'default'
}

function subscribedStatusLabel(row: ModItemDto): string {
  if (row.installStatus === 'pending' || isPendingWorkshop(row.workshopId)) {
    return MOD_INSTALL_STATUS.pending.label
  }
  if (row.installStatus === 'failed') {
    return MOD_INSTALL_STATUS.failed.label
  }
  return MOD_INSTALL_STATUS.ready.label
}

function subscribedStatusType(row: ModItemDto): 'success' | 'warning' | 'error' {
  if (row.installStatus === 'pending' || isPendingWorkshop(row.workshopId)) return 'warning'
  return row.installStatus === 'failed' ? 'error' : 'success'
}

function mergeSteamRowsWithInstalled(
  items: SteamModListQueryResultItem[],
  mods: ModItemDto[],
): SteamModListQueryResultItem[] {
  const localByWorkshopId = new Map(mods.map(mod => [mod.workshopId, mod]))
  return items.map((item) => {
    const local = localByWorkshopId.get(item.workshopId)
    if (!local) {
      return item
    }
    const isPending = local.installStatus === 'pending'
      || item.pendingDownload
      || isPendingWorkshop(item.workshopId)
    return {
      ...item,
      subscribed: true,
      subscribeStatus: local.installStatus,
      installed: local.installStatus === 'ready',
      pendingDownload: isPending,
    }
  })
}

function mergeSteamRowAfterJob(workshopId: string, status: ModInstallStatus) {
  steamMods.value = steamMods.value.map(row => (
    row.workshopId === workshopId
      ? {
          ...row,
          subscribed: true,
          subscribeStatus: status,
          installed: status === 'ready',
          pendingDownload: status === 'pending',
        }
      : row
  ))
}

function applyJobResultToInstalledMods(workshopId: string, mod?: ModItemDto, error?: string | null) {
  if (mod) {
    const existingIndex = installedMods.value.findIndex(item => item.workshopId === workshopId)
    if (existingIndex >= 0) {
      installedMods.value[existingIndex] = mod
    }
    else {
      installedMods.value = [...installedMods.value, mod]
    }
    return
  }
  const existingIndex = installedMods.value.findIndex(item => item.workshopId === workshopId)
  if (existingIndex >= 0) {
    installedMods.value[existingIndex] = {
      ...installedMods.value[existingIndex],
      installStatus: error ? 'failed' : 'ready',
      installError: error ?? null,
    }
  }
}
const steamSourceLabel = computed(() => {
  if (!steamMeta.value) {
    return ''
  }
  if (steamMeta.value.upstreamSource === 'official') {
    return '官方 Web API'
  }
  if (steamMeta.value.upstreamSource === 'relay') {
    return '海外中转'
  }
  return '社区页面抓取'
})
const steamMetaText = computed(() => {
  if (!steamMeta.value) {
    return ''
  }
  const ageMs = steamMeta.value.cacheAgeMs
  const ageText = ageMs < 60_000
    ? `${Math.max(1, Math.round(ageMs / 1000))} 秒前`
    : `${Math.max(1, Math.round(ageMs / 60_000))} 分钟前`
  if (steamMeta.value.stale) {
    return `当前显示缓存结果（${ageText}），后台正在刷新，来源：${steamSourceLabel.value}`
  }
  if (steamMeta.value.cached) {
    return `当前显示缓存结果（${ageText}），来源：${steamSourceLabel.value}`
  }
  if (steamMeta.value.upstreamSource === 'official') {
    return '当前显示实时结果，来源：官方 Web API'
  }
  return `当前显示实时结果，已降级到${steamSourceLabel.value}`
})

const steamSortOptions = computed(() => [
  { label: '最热门', value: 'trend' as const },
  { label: '最新', value: 'mostrecent' as const },
  { label: '相关性', value: 'relevance' as const, disabled: !hasSteamKeyword.value },
  { label: '最多订阅', value: 'totaluniquesubscribers' as const },
])

const steamTrendDaysOptions = [
  { label: '今天', value: 1 },
  { label: '一周', value: 7 },
  { label: '30 天', value: 30 },
  { label: '三个月', value: 90 },
  { label: '半年', value: 180 },
  { label: '一年', value: 365 },
  { label: '有史以来', value: -1 },
]

const STEAM_UPSTREAM_HINT_FALLBACK = '暂时无法加载 Steam 列表，请稍后点击刷新重试'

const TECHNICAL_STEAM_ERROR_PATTERNS = [
  /^Command failed:/i,
  /powershell/i,
  /ParserError/i,
  /CategoryInfo/i,
  /FullyQualifiedErrorId/i,
  /At line:\d+/i,
  /Invoke-WebRequest/i,
]

function isTechnicalSteamErrorMessage(message: string): boolean {
  const normalized = message.trim()
  return !normalized || TECHNICAL_STEAM_ERROR_PATTERNS.some(pattern => pattern.test(normalized))
}

function resolveSteamUpstreamHint(message?: string | null): string {
  if (!message || isTechnicalSteamErrorMessage(message)) {
    return STEAM_UPSTREAM_HINT_FALLBACK
  }
  return message
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return isTechnicalSteamErrorMessage(error.message) ? fallback : error.message
  }
  if (typeof error === 'object' && error && 'error' in error) {
    const apiError = error as BusinessErrorLike
    if (apiError.error) {
      return isTechnicalSteamErrorMessage(apiError.error) ? fallback : apiError.error
    }
  }
  return fallback
}

function isAuthUnauthorizedError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as BusinessErrorLike).code === 'AUTH_UNAUTHORIZED'
}

function isRequestCanceled(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ERR_CANCELED'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function showSubscribeSuccessGuide() {
  subscribeGuideNotificationRef.value?.destroy()
  subscribeGuideNotificationRef.value = notification.success({
    title: '订阅成功',
    content: 'Mod 已下载完成。请到「世界与洞穴」开启该 Mod，重启实例后生效。',
    duration: 0,
    closable: true,
    onClose: () => {
      subscribeGuideNotificationRef.value = null
    },
    action: () => h(
      NButton,
      {
        size: 'small',
        type: 'primary',
        secondary: true,
        onClick: () => {
          subscribeGuideNotificationRef.value?.destroy()
          subscribeGuideNotificationRef.value = null
          if (selectedInstanceId.value) {
            router.push(routeToDstWorldSettings(selectedInstanceId.value))
          }
        },
      },
      { default: () => '去开启 Mod' },
    ),
  })
}

function renderMarketStatus(row: SteamModListQueryResultItem) {
  const status = resolveMarketSubscribeStatus(row)
  if (!status) {
    return h(
      NTag,
      { size: 'small', bordered: false, type: 'default' },
      { default: () => '未订阅' },
    )
  }
  if (status === 'pending') {
    return h(
      NTag,
      { size: 'small', bordered: false, type: 'warning' },
      { default: () => '下载中' },
    )
  }
  if (status === 'failed') {
    return h(
      NTag,
      { size: 'small', bordered: false, type: 'error' },
      { default: () => '已订阅 · 下载失败' },
    )
  }
  return h(
    NTag,
    { size: 'small', bordered: false, type: 'success' },
    { default: () => '已订阅' },
  )
}

function isSteamTransientError(error: unknown): boolean {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = (error as { data?: { steamErrorCode?: string } }).data
    const code = data?.steamErrorCode
    return code === 'STEAM_TIMEOUT' || code === 'STEAM_UPSTREAM_UNAVAILABLE' || code === 'STEAM_RATE_LIMIT'
  }
  return false
}

const marketColumns: DataTableColumns<SteamModListQueryResultItem> = [
  {
    title: '缩略图',
    key: 'previewImage',
    width: 72,
    render: row => renderModPreview(row.previewImage),
  },
  {
    title: 'Mod 名称',
    key: 'title',
    minWidth: 220,
    render: row => row.title,
  },
  {
    title: '评价',
    key: 'rating',
    width: 130,
    render: row => renderModRating(row.rating),
  },
  {
    title: '创意工坊 ID',
    key: 'workshopId',
    width: 150,
    render: row => row.workshopId,
  },
  {
    title: '状态',
    key: 'subscribeStatus',
    width: 140,
    render: row => renderMarketStatus(row),
  },
  {
    title: '操作',
    key: 'actions',
    width: 190,
    render: row => h('div', { class: 'flex items-center gap-3' }, [
      h(
        NButton,
        {
          size: 'tiny',
          type: row.subscribeStatus === 'failed'
            ? 'primary'
            : (row.installed ? 'default' : 'primary'),
          disabled: !hasSelectedInstance.value
            || (unsubscribingWorkshopIds.value.has(row.workshopId))
            || (resolveMarketSubscribeStatus(row) === 'pending'),
          loading: unsubscribingWorkshopIds.value.has(row.workshopId),
          class: 'min-w-[4.5rem]',
          onClick: () => {
            const status = resolveMarketSubscribeStatus(row)
            if (row.installed || status === 'ready') {
              confirmUnsubscribeFromMarket(row)
              return
            }
            if (status === 'failed') {
              void retryFromMarket(row)
              return
            }
            if (status === 'pending') {
              return
            }
            void installFromSteam(row)
          },
        },
        {
          default: () => {
            if (row.installed || resolveMarketSubscribeStatus(row) === 'ready') {
              return '取消订阅'
            }
            if (isPendingWorkshop(row.workshopId)) {
              return '订阅中'
            }
            if (resolveMarketSubscribeStatus(row) === 'failed') {
              return '重试'
            }
            return '订阅'
          },
        },
      ),
      h(
        NButton,
        {
          size: 'tiny',
          text: true,
          disabled: !hasSelectedInstance.value,
          onClick: () => goToModDetail(row.workshopId),
        },
        { default: () => '详情' },
      ),
    ]),
  },
]

const subscribedColumns: DataTableColumns<ModItemDto> = [
  {
    type: 'selection',
  },
  {
    title: '缩略图',
    key: 'previewImage',
    width: 72,
    render: row => renderModPreview(row.previewImage),
  },
  {
    title: 'Mod 名称',
    key: 'name',
    minWidth: 220,
    render: row => row.name,
  },
  {
    title: '评价',
    key: 'rating',
    width: 130,
    render: row => renderModRating(row.rating),
  },
  {
    title: '创意工坊 ID',
    key: 'workshopId',
    width: 150,
    render: row => row.workshopId,
  },
  {
    title: '状态',
    key: 'installStatus',
    width: 130,
    render: (row) => {
      const pending = row.installStatus === 'pending' || isPendingWorkshop(row.workshopId)
      const label = pending
        ? MOD_INSTALL_STATUS.pending.label
        : row.installStatus === 'failed' ? MOD_INSTALL_STATUS.failed.label : MOD_INSTALL_STATUS.ready.label
      const type = pending ? 'warning' : row.installStatus === 'failed' ? 'error' : 'success'
      const tag = h(NTag, { size: 'small', bordered: false, type }, { default: () => label })
      const errorText = row.installError?.trim()
      if (!errorText) {
        return tag
      }
      return h(
        NTooltip,
        { trigger: 'hover' },
        {
          trigger: () => tag,
          default: () => errorText.length > 160 ? `${errorText.slice(0, 160)}…` : errorText,
        },
      )
    },
  },
  {
    title: '启用',
    key: 'enabled',
    width: 90,
    render: row => h(NSwitch, {
      size: 'small',
      value: row.enabled,
      disabled: !hasSelectedInstance.value
        || row.installStatus !== 'ready'
        || isPendingWorkshop(row.workshopId)
        || unsubscribingWorkshopIds.value.has(row.workshopId),
      'onUpdate:value': () => void toggleSubscribedMod(row),
    }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 310,
    render: row => h('div', { class: 'flex items-center gap-3' }, [
      ...(row.installStatus === 'ready'
        ? [h(
            NButton,
            {
              size: 'tiny',
              disabled: !hasSelectedInstance.value || isPendingWorkshop(row.workshopId),
              class: 'w-14',
              onClick: () => void updateInstalledMod(row),
            },
            { default: () => '更新' },
          ),
          h(
            NButton,
            {
              size: 'tiny',
              disabled: !hasSelectedInstance.value || isPendingWorkshop(row.workshopId),
              class: 'w-14',
              onClick: () => openModConfig(row),
            },
            { default: () => '配置' },
          )]
        : []),
      h(
        NButton,
        {
          size: 'tiny',
          type: row.installStatus === 'failed' ? 'primary' : 'default',
          disabled: !hasSelectedInstance.value
            || unsubscribingWorkshopIds.value.has(row.workshopId)
            || row.installStatus === 'pending'
            || isPendingWorkshop(row.workshopId),
          loading: unsubscribingWorkshopIds.value.has(row.workshopId),
          class: 'w-16',
          onClick: () => {
            if (row.installStatus === 'failed') {
              void retryFailedInstall(row)
              return
            }
            confirmUnsubscribe(row)
          },
        },
        { default: () => (row.installStatus === 'failed' ? '重试' : '取消订阅') },
      ),
      h(
        NButton,
        {
          size: 'tiny',
          text: true,
          disabled: !hasSelectedInstance.value,
          onClick: () => goToModDetail(row.workshopId),
        },
        { default: () => '详情' },
      ),
    ]),
  },
]

async function loadInstances() {
  loadingInstances.value = true
  try {
    const response = await apiInstance.getInstanceList()
    const rows = (response.data ?? []) as InstanceItem[]
    instances.value = rows.filter(isInstallableGameInstance)
    if (instances.value.length === 0) {
      selectedInstanceId.value = ''
    }
    else if (!selectedInstanceId.value || !instances.value.some(item => item.id === selectedInstanceId.value)) {
      selectedInstanceId.value = instances.value[0].id
    }
  }
  catch (error: unknown) {
    instances.value = []
    selectedInstanceId.value = ''
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '加载实例失败，请稍后重试'))
  }
  finally {
    loadingInstances.value = false
  }
}

async function loadInstalledMods() {
  if (!selectedInstanceId.value) {
    installedMods.value = []
    resetState()
    return
  }
  loadingInstalled.value = true
  try {
    const response = await apiMod.getModList(selectedInstanceId.value)
    installedMods.value = response.data.mods
    riskTipBanner.value = response.data.riskTip?.trim() || null
    void restoreInstallJobs({
      modList: response.data,
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    installedMods.value = []
    resetState()
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '加载已订阅 Mod 失败'))
  }
  finally {
    loadingInstalled.value = false
  }
}

async function handleInstallJobTerminal(job: Awaited<ReturnType<typeof apiMod.pollModInstallJob>>) {
  if (!selectedInstanceId.value) {
    return
  }
  if (job.status === 'success') {
    if (job.mod) {
      applyJobResultToInstalledMods(job.workshopId, job.mod)
    }
    else {
      await loadInstalledMods()
    }
    mergeSteamRowAfterJob(job.workshopId, 'ready')
    showSubscribeSuccessGuide()
    return
  }
  if (job.status === 'failed') {
    applyJobResultToInstalledMods(job.workshopId, undefined, job.error)
    mergeSteamRowAfterJob(job.workshopId, 'failed')
    message.error(job.error || '订阅失败，请稍后重试')
    return
  }
  if (job.status === 'not_found') {
    await loadInstalledMods()
  }
}

/** 已订阅列表的启用/关闭开关（与 ShardModsSection 一致：重启后生效） */
async function toggleSubscribedMod(item: ModItemDto) {
  if (!selectedInstanceId.value || unsubscribingWorkshopIds.value.has(item.workshopId) || item.installStatus !== 'ready') {
    return
  }
  const nextMutating = new Set(unsubscribingWorkshopIds.value)
  nextMutating.add(item.workshopId)
  unsubscribingWorkshopIds.value = nextMutating
  try {
    const response = await apiMod.updateMod(selectedInstanceId.value, item.workshopId, {
      enabled: !item.enabled,
    })
    const riskTip = response.data.riskTip?.trim()
    message.success(`${item.enabled ? '已关闭' : '已开启'}该 Mod，重启实例后生效（可在实例管理执行重启）`)
    if (riskTip) {
      riskTipBanner.value = riskTip
    }
    installedMods.value = installedMods.value.map(row => (
      row.workshopId === item.workshopId
        ? { ...row, enabled: !row.enabled }
        : row
    ))
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '更新 Mod 状态失败，请稍后重试'))
  }
  finally {
    const next = new Set(unsubscribingWorkshopIds.value)
    next.delete(item.workshopId)
    unsubscribingWorkshopIds.value = next
  }
}

async function retryFromMarket(row: SteamModListQueryResultItem) {
  if (!selectedInstanceId.value || isPendingWorkshop(row.workshopId)) {
    return
  }
  mergeSteamRowAfterJob(row.workshopId, 'pending')
  ensurePendingInInstalledList(row)
  try {
    await installMod({
      workshopId: row.workshopId,
      name: row.title,
      previewImage: row.previewImage ?? undefined,
    }, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '重试订阅失败，请稍后重试'))
  }
}

async function retryFailedInstall(row: ModItemDto) {
  if (!selectedInstanceId.value || isPendingWorkshop(row.workshopId)) {
    return
  }
  try {
    await installMod({
      workshopId: row.workshopId,
      name: row.name,
      previewImage: row.previewImage ?? undefined,
    }, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '重试订阅失败，请稍后重试'))
  }
}

function openModConfig(row: ModItemDto) {
  if (!selectedInstanceId.value || row.installStatus !== 'ready') {
    return
  }
  configTarget.value = { workshopId: row.workshopId, name: row.name }
  configModalShow.value = true
}

function onModConfigSaved(riskTip: string | null) {
  if (riskTip?.trim()) {
    riskTipBanner.value = riskTip.trim()
  }
  void loadInstalledMods()
}

/** 单独更新：强制重新下载已就绪的 Mod（订阅保持不变） */
async function updateInstalledMod(row: ModItemDto) {
  if (!selectedInstanceId.value || isPendingWorkshop(row.workshopId)) {
    return
  }
  try {
    await installMod({
      workshopId: row.workshopId,
      name: row.name,
      previewImage: row.previewImage ?? undefined,
      force: true,
    }, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '更新 Mod 失败，请稍后重试'))
  }
}

/** 批量更新选中的 Mod：订阅入列，后台逐个重新下载 */
async function batchUpdateSelectedMods() {
  const targets = selectedUpdatableMods.value
  if (!selectedInstanceId.value || targets.length === 0 || batchUpdating.value) {
    return
  }
  const skippedCount = checkedRowKeys.value.length - targets.length
  batchUpdating.value = true
  try {
    const response = await apiMod.batchUpdateMods(selectedInstanceId.value, {
      workshopIds: targets.map(mod => mod.workshopId),
    })
    const downloadingIds = response.data
      .filter(job => job.status === 'downloading')
      .map(job => job.workshopId)
    syncPendingWorkshopIds(downloadingIds, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
    const notFoundCount = response.data.filter(job => job.status === 'not_found').length
    message.success('已开始更新 ' + downloadingIds.length + ' 个 Mod，可在列表中查看进度')
    if (notFoundCount > 0) {
      message.warning(notFoundCount + ' 个 Mod 不存在，已跳过')
    }
    if (skippedCount > 0) {
      message.info(skippedCount + ' 个 Mod 正在下载中，本次已跳过')
    }
    checkedRowKeys.value = []
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '批量更新失败，请稍后重试'))
  }
  finally {
    batchUpdating.value = false
  }
}

async function loadSteamMods(
  resetPage = false,
  options?: { isRetry?: boolean, suppressErrorToast?: boolean },
) {
  if (!selectedInstanceId.value) {
    steamMods.value = []
    steamHasMore.value = false
    steamTotalCount.value = null
    steamTotalPages.value = null
    steamMeta.value = null
    steamUpstreamHint.value = null
    return
  }
  if (resetPage) {
    steamPage.value = 1
  }
  steamAbortController.value?.abort()
  const controller = new AbortController()
  steamAbortController.value = controller
  loadingSteam.value = true
  try {
    const response = await apiMod.getSteamModList(selectedInstanceId.value, {
      keyword: steamKeyword.value.trim() || undefined,
      page: steamPage.value,
      pageSize: steamPageSize.value,
      sort: steamSort.value,
      trendDays: steamTrendDays.value,
    }, {
      signal: controller.signal,
    })
    if (controller.signal.aborted) {
      return
    }
    if (response.data.meta?.upstreamUnavailable) {
      steamUpstreamHint.value = resolveSteamUpstreamHint(response.data.meta.upstreamMessage)
      steamMods.value = []
      steamSourceUrl.value = response.data.sourceUrl
      steamHasMore.value = false
      steamTotalCount.value = null
      steamTotalPages.value = null
      steamPage.value = response.data.page
      steamPageSize.value = response.data.pageSize > 0 ? response.data.pageSize : steamPageSize.value
      steamMeta.value = response.data.meta
      return
    }
    steamUpstreamHint.value = null
    steamLoadError.value = null
    steamMods.value = mergeSteamRowsWithInstalled(response.data.items, installedMods.value)
    steamSourceUrl.value = response.data.sourceUrl
    steamHasMore.value = response.data.hasMore
    steamTotalCount.value = response.data.totalCount
    steamTotalPages.value = response.data.totalPages
    steamPage.value = response.data.page
    steamPageSize.value = response.data.pageSize > 0 ? response.data.pageSize : steamPageSize.value
    steamMeta.value = response.data.meta
    syncPendingWorkshopIds(response.data.pendingWorkshopIds ?? [], {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    if (isRequestCanceled(error)) {
      return
    }
    if (!options?.isRetry && isSteamTransientError(error)) {
      await sleep(1800)
      if (!controller.signal.aborted) {
        return loadSteamMods(resetPage, { isRetry: true })
      }
      return
    }
    steamMods.value = []
    steamSourceUrl.value = ''
    steamHasMore.value = false
    steamTotalCount.value = null
    steamTotalPages.value = null
    steamMeta.value = null
    if (isAuthUnauthorizedError(error)) {
      return
    }
    steamLoadError.value = getErrorMessage(error, 'Steam 创意工坊列表加载失败，请点击重试')
    if (!options?.suppressErrorToast) {
      message.error(getErrorMessage(error, '加载 Steam 创意工坊列表失败'))
    }
  }
  finally {
    if (steamAbortController.value === controller) {
      steamAbortController.value = null
    }
    loadingSteam.value = false
  }
}

function ensurePendingInInstalledList(item: Pick<SteamModListQueryResultItem, 'workshopId' | 'title' | 'previewImage'>) {
  const existingIndex = installedMods.value.findIndex(mod => mod.workshopId === item.workshopId)
  if (existingIndex >= 0) {
    installedMods.value[existingIndex] = {
      ...installedMods.value[existingIndex],
      installStatus: 'pending',
      installError: null,
    }
    return
  }
  const now = new Date().toISOString()
  installedMods.value = [...installedMods.value, {
    id: item.workshopId,
    workshopId: item.workshopId,
    name: item.title,
    previewImage: item.previewImage,
    rating: null,
    enabled: false,
    loadOrder: installedMods.value.length,
    version: null,
    installStatus: 'pending',
    installError: null,
    dependencyIds: [],
    missingDependencyIds: [],
    dependentModIds: [],
    createdAt: now,
    updatedAt: now,
  }]
}

async function installFromSteam(item: SteamModListQueryResultItem) {
  const status = resolveMarketSubscribeStatus(item)
  if (!selectedInstanceId.value || status === 'ready' || status === 'pending') {
    return
  }
  mergeSteamRowAfterJob(item.workshopId, 'pending')
  ensurePendingInInstalledList(item)
  try {
    await installMod({
      workshopId: item.workshopId,
      name: item.title,
      previewImage: item.previewImage ?? undefined,
    }, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '订阅失败，请稍后重试'))
  }
}

function handleMarketAction(item: SteamModListQueryResultItem) {
  const status = resolveMarketSubscribeStatus(item)
  if (item.installed || status === 'ready') {
    confirmUnsubscribeFromMarket(item)
    return
  }
  if (status === 'failed') {
    void retryFromMarket(item)
    return
  }
  if (status !== 'pending') {
    void installFromSteam(item)
  }
}

function marketActionLabel(item: SteamModListQueryResultItem): string {
  const status = resolveMarketSubscribeStatus(item)
  if (item.installed || status === 'ready') return '取消订阅'
  if (status === 'pending' || isPendingWorkshop(item.workshopId)) return '订阅中'
  return status === 'failed' ? '重试' : '订阅'
}

function marketActionDisabled(item: SteamModListQueryResultItem): boolean {
  return !hasSelectedInstance.value
    || unsubscribingWorkshopIds.value.has(item.workshopId)
    || resolveMarketSubscribeStatus(item) === 'pending'
}

function handleSubscribedAction(item: ModItemDto) {
  if (item.installStatus === 'failed') {
    void retryFailedInstall(item)
    return
  }
  confirmUnsubscribe(item)
}

function confirmUnsubscribe(row: ModItemDto) {
  openUnsubscribeConfirm(row.workshopId, row.name)
}

function confirmUnsubscribeFromMarket(row: SteamModListQueryResultItem) {
  openUnsubscribeConfirm(row.workshopId, row.title)
}

function openUnsubscribeConfirm(workshopId: string, modName: string) {
  if (!selectedInstanceId.value) {
    message.warning('请先选择实例')
    return
  }
  dialog.warning({
    title: '取消订阅',
    content: `确定从当前实例取消订阅「${modName}」吗？`,
    positiveText: '取消订阅',
    negativeText: '保留',
    onPositiveClick: () => {
      void unsubscribeMod(workshopId)
    },
  })
}

async function unsubscribeMod(workshopId: string) {
  if (!selectedInstanceId.value || unsubscribingWorkshopIds.value.has(workshopId)) {
    return
  }
  const nextUnsubscribing = new Set(unsubscribingWorkshopIds.value)
  nextUnsubscribing.add(workshopId)
  unsubscribingWorkshopIds.value = nextUnsubscribing
  try {
    await apiMod.deleteMod(selectedInstanceId.value, workshopId)
    installedMods.value = installedMods.value.filter(item => item.workshopId !== workshopId)
    steamMods.value = steamMods.value.map(item => (
      item.workshopId === workshopId
        ? {
            ...item,
            subscribed: false,
            subscribeStatus: null,
            installed: false,
            pendingDownload: false,
          }
        : item
    ))
    message.success('已取消订阅')
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '取消订阅失败，请稍后重试'))
  }
  finally {
    const next = new Set(unsubscribingWorkshopIds.value)
    next.delete(workshopId)
    unsubscribingWorkshopIds.value = next
  }
}

const manualWorkshopInput = ref('')

/** 从工坊详情页链接或纯数字输入中提取 Workshop ID */
function extractWorkshopId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  const urlMatch = trimmed.match(/filedetails\?id=(\d+)/i)
  if (urlMatch) {
    return urlMatch[1]
  }
  return /^\d+$/.test(trimmed) ? trimmed : null
}

/** 粘贴工坊 ID/链接直接订阅（不依赖创意工坊列表可用） */
async function subscribeManualWorkshop() {
  const workshopId = extractWorkshopId(manualWorkshopInput.value)
  if (!workshopId) {
    message.warning('请输入有效的创意工坊 ID（纯数字）或 Mod 详情页链接')
    return
  }
  if (!selectedInstanceId.value) {
    message.warning('请先选择实例')
    return
  }
  const existing = installedMods.value.find(mod => mod.workshopId === workshopId)
  if (existing && existing.installStatus === 'ready') {
    message.info('该 Mod 已在订阅列表中')
    return
  }
  ensurePendingInInstalledList({ workshopId, title: `工坊 ${workshopId}`, previewImage: null })
  try {
    await installMod({
      workshopId,
      name: `工坊 ${workshopId}`,
    }, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
    manualWorkshopInput.value = ''
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '订阅失败，请稍后重试'))
  }
}

function onInstanceChange(value: string) {
  selectedInstanceId.value = value
  activeTab.value = 'market'
  checkedRowKeys.value = []
  resetState()
  void Promise.all([loadSteamMods(true), loadInstalledMods()])
}

const triggerSteamReloadDebounced = useDebounceFn(() => {
  if (!selectedInstanceId.value) {
    return
  }
  void loadSteamMods(true)
}, 400)

watch([steamSort, steamTrendDays], () => {
  if (Date.now() < suppressSteamSortWatchUntil.value) {
    return
  }
  if (!selectedInstanceId.value) {
    return
  }
  triggerSteamReloadDebounced()
})

watch(steamKeyword, (keyword, previousKeyword) => {
  if (!keyword.trim() && steamSort.value === 'relevance') {
    steamSort.value = 'trend'
    if (selectedInstanceId.value) {
      triggerSteamReloadDebounced()
    }
    return
  }
  if (!selectedInstanceId.value || keyword.trim() === previousKeyword.trim()) {
    return
  }
  triggerSteamReloadDebounced()
})

watch(activeTab, (tab) => {
  if (tab === 'subscribed' && selectedInstanceId.value && !loadingInstalled.value) {
    void loadInstalledMods()
  }
})

onMounted(async () => {
  suppressSteamSortWatchUntil.value = Date.now() + 500
  await loadInstances()
  await Promise.all([loadSteamMods(true), loadInstalledMods()])
})
</script>

<template>
  <div class="dst-mod-page absolute inset-0 flex flex-col overflow-hidden p-4">
    <FaPageMain
      title="DST Mod 订阅"
      class="flex min-h-0 flex-1 flex-col overflow-hidden !m-0 h-full"
      main-class="flex min-h-0 flex-1 flex-col"
    >
    <p class="mb-4 shrink-0 text-sm text-muted-foreground">
      订阅服务器 Mod：在「Mod 市场」浏览 Steam 创意工坊，或在「已订阅」页签管理当前实例的 Mod 并控制开启状态。开启后需重启实例生效。
    </p>

    <NCard size="small" title="实例选择" class="mb-4 shrink-0">
      <div class="flex flex-wrap items-center gap-3">
        <NSelect
          style="width: 320px"
          :value="selectedInstanceId || null"
          :loading="loadingInstances"
          :options="instanceOptions"
          :disabled="!hasInstallableInstances"
          :placeholder="instanceSelectPlaceholder"
          @update:value="onInstanceChange"
        />
        <NButton
          v-if="!hasInstallableInstances && !loadingInstances"
          type="primary"
          @click="router.push(routeToNodeInstance())"
        >
          前往实例管理
        </NButton>
        <span v-if="hasSelectedInstance" class="text-xs text-muted-foreground">
          当前目标实例：{{ selectedInstanceName }}
        </span>
      </div>
    </NCard>

    <NAlert
      v-if="riskTipBanner"
      type="warning"
      class="mb-4 shrink-0"
      closable
      @close="riskTipBanner = null"
    >
      {{ riskTipBanner }}
    </NAlert>

    <NCard
      size="small"
      title="Steam 创意工坊"
      class="dst-mod-workshop-card flex min-h-0 flex-1 flex-col"
      content-class="flex min-h-0 flex-1 flex-col"
    >
      <div class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex shrink-0 flex-wrap items-center gap-3">
          <div
            v-if="steamUpstreamHint"
            class="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning"
          >
            <span>{{ steamUpstreamHint }}</span>
            <NButton size="small" :disabled="!selectedInstanceId || loadingSteam" @click="loadSteamMods(true)">
              重试
            </NButton>
          </div>
          <AdminListToolbar
            v-model:keyword="steamKeyword"
            keyword-placeholder="按名称搜索 Mod"
            :search-loading="loadingSteam"
            :disable-search-loading="loadingSteam"
            :reset-disabled="!steamKeyword && steamSort === 'trend' && steamTrendDays === 7"
            @search="loadSteamMods(true)"
            @reset="() => { steamKeyword = ''; steamSort = 'trend'; steamTrendDays = 7; loadSteamMods(true) }"
          >
            <template #filters>
              <NSelect
                v-model:value="steamSort"
                class="w-full md:w-36"
                :options="steamSortOptions"
              />
              <NSelect
                v-model:value="steamTrendDays"
                class="w-full md:w-36"
                :disabled="!isSteamTrendSort"
                :options="steamTrendDaysOptions"
              />
            </template>
            <template #actions>
              <NInput
                v-model:value="manualWorkshopInput"
                class="w-full md:w-56"
                placeholder="粘贴工坊 ID 或详情页链接"
                clearable
                @keydown.enter="subscribeManualWorkshop"
              />
              <NButton :disabled="!selectedInstanceId" @click="subscribeManualWorkshop">
                直接订阅
              </NButton>
              <NButton type="primary" :disabled="!selectedInstanceId" @click="loadSteamMods(true)">
                刷新列表
              </NButton>
            </template>
          </AdminListToolbar>
          <span v-if="steamPagingSummary" class="text-xs text-muted-foreground whitespace-nowrap">
            {{ steamPagingSummary }}
          </span>
          <span v-if="steamMetaText" class="text-xs text-muted-foreground whitespace-nowrap">
            {{ steamMetaText }}
          </span>
          <span v-if="steamSourceUrl" class="text-xs text-muted-foreground whitespace-nowrap">
            数据来源：<a :href="steamSourceUrl" target="_blank" class="underline">Steam Workshop</a>
          </span>
        </div>

        <NTabs v-model:value="activeTab" type="segment" class="dst-mod-tabs min-h-0 flex-1">
          <NTabPane name="market" tab="Mod 市场" display-directive="show" class="h-full">
            <NDataTable
              v-if="!isMobileMode"
              :bordered="false"
              :single-line="false"
              :columns="marketColumns"
              :data="steamMods"
              :loading="loadingSteam"
              :pagination="pagination"
              class="dst-mod-table h-full"
              flex-height
              remote
              :scroll-x="1180"
            >
              <template #empty>
                <div class="dst-mod-table-empty">
                  <NEmpty size="small" :description="marketEmptyDescription">
                    <template v-if="steamLoadError" #extra>
                      <NButton size="small" @click="loadSteamMods(true)">
                        重试
                      </NButton>
                    </template>
                  </NEmpty>
                </div>
              </template>
            </NDataTable>
            <div v-else class="space-y-3 overflow-y-auto pr-1" :aria-busy="loadingSteam">
              <NEmpty v-if="!loadingSteam && steamMods.length === 0" size="small" :description="marketEmptyDescription">
                <template v-if="steamLoadError" #extra>
                  <NButton size="small" @click="loadSteamMods(true)">
                    重试
                  </NButton>
                </template>
              </NEmpty>
              <article
                v-for="mod in steamMods"
                :key="mod.workshopId"
                class="rounded-lg border border-border bg-card p-3 space-y-3"
              >
                <div class="flex gap-3">
                  <NImage
                    v-if="mod.previewImage"
                    :src="mod.previewImage"
                    width="64"
                    height="64"
                    object-fit="cover"
                    class="shrink-0 rounded"
                  />
                  <div class="min-w-0 flex-1">
                    <h3 class="line-clamp-2 font-medium">{{ mod.title }}</h3>
                    <p class="mt-1 text-xs text-muted-foreground">Workshop ID: {{ mod.workshopId }}</p>
                    <NRate v-if="mod.rating != null" class="mt-1" readonly allow-half size="small" :value="mod.rating" />
                  </div>
                  <NTag size="small" :bordered="false" :type="marketStatusType(mod)">
                    {{ marketStatusLabel(mod) }}
                  </NTag>
                </div>
                <div class="flex gap-2">
                  <NButton
                    class="flex-1"
                    type="primary"
                    :loading="unsubscribingWorkshopIds.has(mod.workshopId)"
                    :disabled="marketActionDisabled(mod)"
                    @click="handleMarketAction(mod)"
                  >
                    {{ marketActionLabel(mod) }}
                  </NButton>
                  <NButton :disabled="!hasSelectedInstance" @click="goToModDetail(mod.workshopId)">
                    详情
                  </NButton>
                </div>
              </article>
              <NPagination
                v-if="resolvedPageCount > 1"
                :page="steamPage"
                :page-count="resolvedPageCount"
                :disabled="loadingSteam"
                simple
                class="justify-center py-2"
                @update:page="changeSteamPage"
              />
            </div>
          </NTabPane>

          <NTabPane
            name="subscribed"
            display-directive="if"
            class="h-full min-h-0"
          >
            <template #tab>
              已订阅 ({{ subscribedTabCount }})
            </template>
            <div class="flex h-full min-h-0 flex-col">
              <div v-if="!isMobileMode" class="flex shrink-0 items-center gap-3 pb-2">
                <span class="text-xs text-muted-foreground">
                  已选 {{ checkedRowKeys.length }} 项
                </span>
                <NButton
                  size="small"
                  type="primary"
                  secondary
                  :loading="batchUpdating"
                  :disabled="selectedUpdatableMods.length === 0"
                  @click="batchUpdateSelectedMods"
                >
                  批量更新
                </NButton>
              </div>
              <NDataTable
                v-if="!isMobileMode"
                :key="`subscribed-${selectedInstanceId}`"
                :bordered="false"
                :single-line="false"
                :columns="subscribedColumns"
                :data="installedMods"
                :loading="loadingInstalled"
                :pagination="false"
                :row-key="(row: ModItemDto) => row.workshopId"
                :checked-row-keys="checkedRowKeys"
                class="dst-mod-table min-h-0 flex-1"
                flex-height
                :scroll-x="1090"
                @update:checked-row-keys="(keys: Array<string | number>) => checkedRowKeys = keys"
              >
                <template #empty>
                  <div class="dst-mod-table-empty">
                    <NEmpty size="small" :description="subscribedEmptyDescription" />
                  </div>
                </template>
              </NDataTable>
              <div v-else class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" :aria-busy="loadingInstalled">
                <NEmpty v-if="!loadingInstalled && installedMods.length === 0" size="small" :description="subscribedEmptyDescription" />
                <article
                  v-for="mod in installedMods"
                  :key="mod.workshopId"
                  class="rounded-lg border border-border bg-card p-3 space-y-3"
                >
                  <div class="flex gap-3">
                    <NImage
                      v-if="mod.previewImage"
                      :src="mod.previewImage"
                      width="64"
                      height="64"
                      object-fit="cover"
                      class="shrink-0 rounded"
                    />
                    <div class="min-w-0 flex-1">
                      <h3 class="line-clamp-2 font-medium">{{ mod.name }}</h3>
                      <p class="mt-1 text-xs text-muted-foreground">Workshop ID: {{ mod.workshopId }}</p>
                      <NRate v-if="mod.rating != null" class="mt-1" readonly allow-half size="small" :value="mod.rating" />
                    </div>
                    <NTag size="small" :bordered="false" :type="subscribedStatusType(mod)">
                      {{ subscribedStatusLabel(mod) }}
                    </NTag>
                  </div>
                  <p v-if="mod.installError" class="text-sm text-rose-600 dark:text-rose-400">{{ mod.installError }}</p>
                  <div class="flex gap-2">
                    <NButton
                      v-if="mod.installStatus === 'ready'"
                      class="flex-1"
                      :disabled="!hasSelectedInstance || isPendingWorkshop(mod.workshopId)"
                      @click="updateInstalledMod(mod)"
                    >
                      更新
                    </NButton>
                    <NButton
                      v-if="mod.installStatus === 'ready'"
                      class="flex-1"
                      :disabled="!hasSelectedInstance || isPendingWorkshop(mod.workshopId)"
                      @click="openModConfig(mod)"
                    >
                      配置
                    </NButton>
                    <NButton
                      class="flex-1"
                      :loading="unsubscribingWorkshopIds.has(mod.workshopId)"
                      :disabled="!hasSelectedInstance || mod.installStatus === 'pending' || isPendingWorkshop(mod.workshopId)"
                      @click="handleSubscribedAction(mod)"
                    >
                      {{ mod.installStatus === 'failed' ? '重试' : '取消订阅' }}
                    </NButton>
                    <NButton :disabled="!hasSelectedInstance" @click="goToModDetail(mod.workshopId)">
                      详情
                    </NButton>
                  </div>
                </article>
              </div>
            </div>
          </NTabPane>
        </NTabs>
      </div>
    </NCard>

    <ModConfigModal
      v-model:show="configModalShow"
      :instance-id="selectedInstanceId"
      :workshop-id="configTarget?.workshopId ?? ''"
      :mod-name="configTarget?.name ?? ''"
      @saved="onModConfigSaved"
    />
    </FaPageMain>
  </div>
</template>

<style scoped>
.dst-mod-page :deep(.group\/pagemain) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dst-mod-workshop-card :deep(.n-card-header) {
  flex-shrink: 0;
}

.dst-mod-tabs :deep(.n-tabs) {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.dst-mod-tabs :deep(.n-tabs-nav) {
  flex-shrink: 0;
}

.dst-mod-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
}

.dst-mod-tabs :deep(.n-tab-pane) {
  height: 100%;
}

.dst-mod-table :deep(.n-data-table-base-table-body) {
  position: relative;
  flex: 1;
  min-height: 0;
}

.dst-mod-table :deep(.n-data-table-empty) {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.dst-mod-table-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
