<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type {
  ModItemDto,
  SteamModListQueryResultItem,
  SteamModSort,
  SteamModTrendDays,
} from '@/api/modules/mod'
import type { InstanceItem } from '@/api/modules/instance'
import { useDebounceFn } from '@vueuse/core'
import { NAlert, NButton, NCard, NDataTable, NEmpty, NImage, NInput, NRate, NSelect, NTabPane, NTabs, NTag, useDialog, useMessage } from 'naive-ui'
import { computed, h, onMounted, ref, shallowRef, watch } from 'vue'
import apiInstance from '@/api/modules/instance'
import apiMod from '@/api/modules/mod'
import { isInstallableGameInstance } from '@/composables/useGameInstance'
import { useInstanceModState } from '@/composables/useInstanceModState'
import { routeToDstWorldSettings, routeToNodeInstance, routeToDstModDetail } from '@/navigation/game-routes'

defineOptions({
  name: 'DstModList',
})

const router = useRouter()
const message = useMessage()
const dialog = useDialog()

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
const instances = ref<InstanceItem[]>([])
const selectedInstanceId = ref('')
const {
  subscribingWorkshopIds,
  downloadingMods,
  isPendingWorkshop,
  resolveSubscribeButtonText,
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

const instanceOptions = computed(() => {
  return instances.value.map(instance => ({
    label: instance.name,
    value: instance.id,
  }))
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
    return '暂无已就绪 Mod，请等待下载完成'
  }
  return '暂无已订阅 Mod'
})
const readyInstalledMods = computed(() =>
  installedMods.value.filter(mod => mod.installStatus === 'ready'),
)
const failedInstalledMods = computed(() =>
  installedMods.value.filter(mod => mod.installStatus === 'failed'),
)
const subscribedTabCount = computed(() => installedMods.value.length)
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'object' && error && 'error' in error) {
    const apiError = error as BusinessErrorLike
    if (apiError.error) {
      return apiError.error
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
  message.success('订阅成功。请到世界设置开启 Mod，并在实例控制台重启实例后生效。', {
    duration: 6000,
  })
}

function goToWorldSettings() {
  if (!selectedInstanceId.value) {
    return
  }
  router.push(routeToDstWorldSettings(selectedInstanceId.value))
}

function isMarketRowBusy(workshopId: string): boolean {
  return isPendingWorkshop(workshopId)
    || subscribingWorkshopIds.value.has(workshopId)
    || unsubscribingWorkshopIds.value.has(workshopId)
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
    key: 'installed',
    width: 110,
    render: (row) => {
      if (row.pendingDownload || isPendingWorkshop(row.workshopId)) {
        return h(
          NTag,
          { size: 'small', bordered: false, type: 'warning' },
          { default: () => '下载中' },
        )
      }
      return h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type: row.installed ? 'success' : 'default',
        },
        { default: () => (row.installed ? '已订阅' : '未订阅') },
      )
    },
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
          type: row.installed ? 'default' : 'primary',
          disabled: !hasSelectedInstance.value
            || isMarketRowBusy(row.workshopId)
            || (row.pendingDownload && !row.installed),
          loading: isPendingWorkshop(row.workshopId) || unsubscribingWorkshopIds.value.has(row.workshopId),
          class: 'w-16',
          onClick: () => {
            if (row.installed) {
              confirmUnsubscribeFromMarket(row)
              return
            }
            if (row.pendingDownload || isPendingWorkshop(row.workshopId)) {
              return
            }
            void installFromSteam(row)
          },
        },
        { default: () => resolveSubscribeButtonText(row.workshopId, row.installed) },
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
    width: 110,
    render: (row) => {
      if (row.installStatus === 'pending' || isPendingWorkshop(row.workshopId)) {
        return h(NTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '下载中' })
      }
      if (row.installStatus === 'failed') {
        return h(NTag, { size: 'small', bordered: false, type: 'error' }, { default: () => '下载失败' })
      }
      return h(NTag, { size: 'small', bordered: false, type: 'success' }, { default: () => '已就绪' })
    },
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
          type: row.installStatus === 'failed' ? 'primary' : 'default',
          disabled: !hasSelectedInstance.value
            || unsubscribingWorkshopIds.value.has(row.workshopId)
            || row.installStatus === 'pending'
            || isPendingWorkshop(row.workshopId),
          loading: unsubscribingWorkshopIds.value.has(row.workshopId)
            || (row.installStatus === 'failed' && isPendingWorkshop(row.workshopId)),
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
    await restoreInstallJobs({
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
    await Promise.all([loadInstalledMods(), loadSteamMods(false, { suppressErrorToast: true })])
    showSubscribeSuccessGuide()
    return
  }
  if (job.status === 'failed') {
    await loadInstalledMods()
    message.error(job.error || '订阅失败，请稍后重试')
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
      steamUpstreamHint.value = response.data.meta.upstreamMessage
        ?? '暂时无法加载 Steam 列表，请稍后点击刷新重试'
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
    steamMods.value = response.data.items
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

async function installFromSteam(item: SteamModListQueryResultItem) {
  if (!selectedInstanceId.value || item.installed || isPendingWorkshop(item.workshopId) || item.pendingDownload) {
    return
  }
  try {
    await installMod({
      workshopId: item.workshopId,
      name: item.title,
      previewImage: item.previewImage ?? undefined,
    }, {
      onTerminal: async (job) => {
        if (job.status === 'success') {
          steamMods.value = steamMods.value.map(row => (
            row.workshopId === item.workshopId
              ? { ...row, installed: true, pendingDownload: false }
              : row
          ))
        }
        await handleInstallJobTerminal(job)
      },
    })
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '订阅失败，请稍后重试'))
  }
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
      item.workshopId === workshopId ? { ...item, installed: false, pendingDownload: false } : item
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

function onInstanceChange(value: string) {
  selectedInstanceId.value = value
  activeTab.value = 'market'
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
      浏览 Steam 创意工坊并订阅到目标实例；在“已订阅”页签可快速查看当前列表中的已订阅 Mod。
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

    <NCard
      size="small"
      title="Steam 创意工坊"
      class="dst-mod-workshop-card flex min-h-0 flex-1 flex-col"
      content-class="flex min-h-0 flex-1 flex-col"
    >
      <div class="flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex shrink-0 flex-wrap items-center gap-3">
          <NAlert
            v-if="steamUpstreamHint"
            type="warning"
            class="w-full"
            :show-icon="false"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm">{{ steamUpstreamHint }}</span>
              <NButton size="small" :disabled="!selectedInstanceId || loadingSteam" @click="loadSteamMods(true)">
                重试
              </NButton>
            </div>
          </NAlert>
          <NInput
            v-model:value="steamKeyword"
            style="width: 280px"
            placeholder="按名称搜索 Mod"
            clearable
            @keydown.enter.prevent="loadSteamMods(true)"
          />
          <NSelect
            v-model:value="steamSort"
            style="width: 140px"
            :options="steamSortOptions"
          />
          <NSelect
            v-model:value="steamTrendDays"
            style="width: 140px"
            :disabled="!isSteamTrendSort"
            :options="steamTrendDaysOptions"
          />
          <NButton type="primary" :disabled="!selectedInstanceId" @click="loadSteamMods(true)">
            刷新列表
          </NButton>
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
                  <NEmpty size="small" :description="marketEmptyDescription" />
                </div>
              </template>
            </NDataTable>
          </NTabPane>

          <NTabPane
            name="subscribed"
            :tab="`已订阅 (${subscribedTabCount})`"
            display-directive="show"
            class="h-full"
          >
            <div class="flex h-full min-h-0 flex-col gap-3">
              <NAlert
                v-if="downloadingMods.length > 0"
                type="info"
                title="下载中的 Mod"
              >
                <div class="space-y-2 text-sm">
                  <p>以下 Mod 正在下载，完成后可在世界设置中开启。</p>
                  <ul class="list-disc pl-5">
                    <li v-for="mod in downloadingMods" :key="mod.workshopId">
                      {{ mod.name }}（{{ mod.workshopId }}）
                    </li>
                  </ul>
                </div>
              </NAlert>
              <NAlert
                v-if="failedInstalledMods.length > 0"
                type="warning"
                title="下载失败的 Mod"
              >
                <div class="space-y-2 text-sm">
                  <p>可在列表中点击「重试」重新下载。</p>
                  <ul class="list-disc pl-5">
                    <li v-for="mod in failedInstalledMods" :key="mod.workshopId">
                      {{ mod.name }}：{{ mod.installError || '下载失败' }}
                    </li>
                  </ul>
                </div>
              </NAlert>
              <NAlert
                v-if="readyInstalledMods.length > 0"
                type="success"
                title="订阅成功后"
              >
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <span>请到世界设置开启 Mod，并在实例控制台重启实例后生效。</span>
                  <NButton size="tiny" type="primary" @click="goToWorldSettings">
                    前往世界设置
                  </NButton>
                </div>
              </NAlert>
              <NDataTable
                :bordered="false"
                :single-line="false"
                :columns="subscribedColumns"
                :data="installedMods"
                :loading="loadingInstalled"
                :pagination="false"
                class="dst-mod-table min-h-0 flex-1"
                flex-height
                :scroll-x="1090"
              >
                <template #empty>
                  <div class="dst-mod-table-empty">
                    <NEmpty size="small" :description="subscribedEmptyDescription" />
                  </div>
                </template>
              </NDataTable>
            </div>
          </NTabPane>
        </NTabs>
      </div>
    </NCard>
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
