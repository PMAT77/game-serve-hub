<script setup lang="ts">
import type {
  MonitorNetworkOption,
  NetworkChartPoint,
  NetworkInterfaceRealtimeData,
  SystemInfoData,
} from './components/types'
import dayjs from 'dayjs'
import { NAlert, NButton, NGrid, NGridItem, NInputNumber, NSpace } from 'naive-ui'
import apiSystem from '@/api/modules/system'
import MonitorNetwork from './components/MonitorNetwork.vue'
import MonitorStatus from './components/MonitorStatus.vue'
import MonitorSystemInfo from './components/MonitorSystemInfo.vue'

defineOptions({
  name: 'ConsoleMonitor',
})

const MONITOR_POLL_STORAGE_KEY = 'gsh-monitor-poll-settings'
const DEFAULT_SYSTEM_POLL_MS = 10_000
const DEFAULT_NETWORK_POLL_MS = 5_000
const MIN_POLL_MS = 2_000
const MAX_POLL_MS = 120_000
const MAX_NETWORK_POINTS = 60
const ALL_INTERFACE_VALUE = '__all__'

interface MonitorPollSettings {
  systemPollMs: number
  networkPollMs: number
}

function loadPollSettings(): MonitorPollSettings {
  try {
    const raw = localStorage.getItem(MONITOR_POLL_STORAGE_KEY)
    if (!raw) {
      return { systemPollMs: DEFAULT_SYSTEM_POLL_MS, networkPollMs: DEFAULT_NETWORK_POLL_MS }
    }
    const parsed = JSON.parse(raw) as Partial<MonitorPollSettings>
    const systemPollMs = Number(parsed.systemPollMs)
    const networkPollMs = Number(parsed.networkPollMs)
    return {
      systemPollMs: Number.isFinite(systemPollMs) && systemPollMs >= MIN_POLL_MS
        ? Math.min(systemPollMs, MAX_POLL_MS)
        : DEFAULT_SYSTEM_POLL_MS,
      networkPollMs: Number.isFinite(networkPollMs) && networkPollMs >= MIN_POLL_MS
        ? Math.min(networkPollMs, MAX_POLL_MS)
        : DEFAULT_NETWORK_POLL_MS,
    }
  }
  catch {
    return { systemPollMs: DEFAULT_SYSTEM_POLL_MS, networkPollMs: DEFAULT_NETWORK_POLL_MS }
  }
}

function savePollSettings(settings: MonitorPollSettings) {
  localStorage.setItem(MONITOR_POLL_STORAGE_KEY, JSON.stringify(settings))
}

const pollSettings = ref(loadPollSettings())
const systemPollMs = computed({
  get: () => pollSettings.value.systemPollMs,
  set: (value: number | null) => {
    if (value === null || !Number.isFinite(value)) {
      return
    }
    pollSettings.value = {
      ...pollSettings.value,
      systemPollMs: Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, value)),
    }
    savePollSettings(pollSettings.value)
    restartSystemPolling()
  },
})
const networkPollMs = computed({
  get: () => pollSettings.value.networkPollMs,
  set: (value: number | null) => {
    if (value === null || !Number.isFinite(value)) {
      return
    }
    pollSettings.value = {
      ...pollSettings.value,
      networkPollMs: Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, value)),
    }
    savePollSettings(pollSettings.value)
    restartNetworkPolling()
  },
})

const loading = ref(false)
const isSystemRequesting = ref(false)
const systemError = ref<string | null>(null)
let systemPollingTimer: ReturnType<typeof setInterval> | null = null
const systemInfo = ref<SystemInfoData | null>(null)

function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

async function loadSystemInfo() {
  if (isSystemRequesting.value) {
    return
  }
  isSystemRequesting.value = true
  if (!systemInfo.value) {
    loading.value = true
  }
  try {
    const res = await apiSystem.getSystemInfo()
    systemInfo.value = res.data
    systemError.value = null
  }
  catch (error) {
    systemError.value = resolveErrorMessage(error, '系统信息加载失败，请稍后重试')
  }
  finally {
    isSystemRequesting.value = false
    loading.value = false
  }
}

function stopSystemPolling() {
  if (!systemPollingTimer) {
    return
  }
  clearInterval(systemPollingTimer)
  systemPollingTimer = null
}

function startSystemPolling() {
  loadSystemInfo()
  stopSystemPolling()
  systemPollingTimer = setInterval(() => {
    loadSystemInfo()
  }, pollSettings.value.systemPollMs)
}

function restartSystemPolling() {
  if (!systemPollingTimer) {
    return
  }
  startSystemPolling()
}

const networkLoading = ref(false)
const isNetworkRequesting = ref(false)
const networkError = ref<string | null>(null)
const networkStale = ref(false)
const selectedInterface = ref<string | null>(ALL_INTERFACE_VALUE)
const networkChartDataMap = ref<Record<string, NetworkChartPoint[]>>({})
let networkPollingTimer: ReturnType<typeof setInterval> | null = null
let lastNetworkSuccessAt: number | null = null

function formatInterfaceLabel(name: string, index: number) {
  const value = name.trim()
  if (!value) {
    return `网卡 ${index + 1}`
  }
  const hasReplacementChar = value.includes('�')
  const hasControlChar = Array.from(value).some(char => char.charCodeAt(0) < 32)
  if (hasReplacementChar || hasControlChar) {
    return `网卡 ${index + 1}`
  }
  return value
}

const interfaceOptions = computed<MonitorNetworkOption[]>(() => {
  const options = Object.keys(networkChartDataMap.value)
    .filter(name => name !== ALL_INTERFACE_VALUE)
    .map((name, index) => ({
      label: formatInterfaceLabel(name, index),
      value: name,
    }))

  if (options.length === 0) {
    return []
  }

  return [
    { label: '所有网卡', value: ALL_INTERFACE_VALUE },
    ...options,
  ]
})

function buildAllInterfaceSeries(interfaces: NetworkInterfaceRealtimeData[], currentTime: string) {
  const totalUpBps = interfaces.reduce((sum, item) => sum + item.upBps, 0)
  const totalDownBps = interfaces.reduce((sum, item) => sum + item.downBps, 0)
  const allSeries = networkChartDataMap.value[ALL_INTERFACE_VALUE] ?? []
  allSeries.push({
    time: currentTime,
    upBps: Number(totalUpBps.toFixed(2)),
    downBps: Number(totalDownBps.toFixed(2)),
  })
  if (allSeries.length > MAX_NETWORK_POINTS) {
    allSeries.splice(0, allSeries.length - MAX_NETWORK_POINTS)
  }
  networkChartDataMap.value[ALL_INTERFACE_VALUE] = allSeries
}

function syncNetworkChartData(interfaces: NetworkInterfaceRealtimeData[], timestamp: number) {
  const nextKeys = new Set<string>([ALL_INTERFACE_VALUE])
  const currentTime = dayjs(timestamp).format('HH:mm:ss')

  buildAllInterfaceSeries(interfaces, currentTime)

  interfaces.forEach((item) => {
    nextKeys.add(item.name)
    const currentSeries = networkChartDataMap.value[item.name] ?? []
    currentSeries.push({
      time: currentTime,
      upBps: item.upBps,
      downBps: item.downBps,
    })
    if (currentSeries.length > MAX_NETWORK_POINTS) {
      currentSeries.splice(0, currentSeries.length - MAX_NETWORK_POINTS)
    }
    networkChartDataMap.value[item.name] = currentSeries
  })

  Object.keys(networkChartDataMap.value).forEach((name) => {
    if (!nextKeys.has(name)) {
      delete networkChartDataMap.value[name]
    }
  })

  if (!selectedInterface.value || !nextKeys.has(selectedInterface.value)) {
    selectedInterface.value = ALL_INTERFACE_VALUE
  }
}

async function loadRealtimeNetworkStats() {
  if (isNetworkRequesting.value) {
    return
  }
  isNetworkRequesting.value = true
  if (!Object.keys(networkChartDataMap.value).length) {
    networkLoading.value = true
  }

  try {
    const response = await apiSystem.getNetworkRealtime()
    syncNetworkChartData(response.data.interfaces, response.data.timestamp)
    lastNetworkSuccessAt = Date.now()
    networkError.value = null
    networkStale.value = false
  }
  catch (error) {
    networkError.value = resolveErrorMessage(error, '网络数据加载失败，请稍后重试')
    networkStale.value = lastNetworkSuccessAt !== null
  }
  finally {
    isNetworkRequesting.value = false
    networkLoading.value = false
  }
}

function stopNetworkPolling() {
  if (!networkPollingTimer) {
    return
  }
  clearInterval(networkPollingTimer)
  networkPollingTimer = null
}

function startNetworkPolling() {
  loadRealtimeNetworkStats()
  stopNetworkPolling()
  networkPollingTimer = setInterval(() => {
    loadRealtimeNetworkStats()
  }, pollSettings.value.networkPollMs)
}

function restartNetworkPolling() {
  if (!networkPollingTimer) {
    return
  }
  startNetworkPolling()
}

onMounted(() => {
  startSystemPolling()
  startNetworkPolling()
})

onActivated(() => {
  startSystemPolling()
  startNetworkPolling()
})

onDeactivated(() => {
  stopSystemPolling()
  stopNetworkPolling()
})

onUnmounted(() => {
  stopSystemPolling()
  stopNetworkPolling()
})
</script>

<template>
  <div>
    <FaPageMain title="轮询设置" >
      <NSpace align="center" wrap>
        <span class="text-sm text-muted-foreground">系统信息间隔（毫秒）</span>
        <NInputNumber v-model:value="systemPollMs" :min="MIN_POLL_MS" :max="MAX_POLL_MS" :step="1000" />
        <span class="text-sm text-muted-foreground">网络采样间隔（毫秒，建议 ≥ 4000）</span>
        <NInputNumber v-model:value="networkPollMs" :min="MIN_POLL_MS" :max="MAX_POLL_MS" :step="1000" />
      </NSpace>
    </FaPageMain>

    <FaPageMain title="实时状态">
      <div v-if="systemError" class="space-y-2">
        <NButton size="small" @click="loadSystemInfo">
          重试
        </NButton>
      </div>
      <MonitorStatus :loading="loading" :info="systemInfo" />
    </FaPageMain>
    <FaPageMain title="系统详情" class="min-w-0">
      <MonitorSystemInfo :loading="loading" :info="systemInfo" />
    </FaPageMain>
    
    <FaPageMain title="网络监控" class="min-w-0">
      <div v-if="networkError" class="space-y-2">
        <NAlert type="warning" :title="networkError">
          <template v-if="networkStale">
            图表仍显示上次可用数据，可能已过期。
          </template>
        </NAlert>
        <NButton size="small" @click="loadRealtimeNetworkStats">
          重试
        </NButton>
      </div>
      <MonitorNetwork
        v-model:selected-interface="selectedInterface"
        :loading="networkLoading"
        :interface-options="interfaceOptions"
        :chart-data-map="networkChartDataMap"
      />
    </FaPageMain>
  </div> 
</template>
