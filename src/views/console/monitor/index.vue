<script setup lang="ts">
import type {
  MonitorNetworkOption,
  NetworkChartPoint,
  NetworkInterfaceRealtimeData,
  SystemInfoData,
} from './components/types'
import dayjs from 'dayjs'
import apiSystem from '@/api/modules/system'
import MonitorNetwork from './components/MonitorNetwork.vue'
import MonitorStatus from './components/MonitorStatus.vue'
import MonitorSystemInfo from './components/MonitorSystemInfo.vue'

defineOptions({
  name: 'ConsoleMonitor',
})

const loading = ref(false)
const isSystemRequesting = ref(false)
let systemPollingTimer: ReturnType<typeof setInterval> | null = null
const SYSTEM_POLLING_INTERVAL_MS = 10_000
const systemInfo = ref<SystemInfoData | null>(null)

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
  }
  catch {
    // 轮询场景下忽略本地异常抛出，避免中断定时任务。
  }
  finally {
    isSystemRequesting.value = false
    loading.value = false
  }
}

function startSystemPolling() {
  loadSystemInfo()
  if (systemPollingTimer) {
    return
  }
  systemPollingTimer = setInterval(() => {
    loadSystemInfo()
  }, SYSTEM_POLLING_INTERVAL_MS)
}

function stopSystemPolling() {
  if (!systemPollingTimer) {
    return
  }
  clearInterval(systemPollingTimer)
  systemPollingTimer = null
}

const networkLoading = ref(false)
const isNetworkRequesting = ref(false)
const ALL_INTERFACE_VALUE = '__all__'
const selectedInterface = ref<string | null>(ALL_INTERFACE_VALUE)
const networkChartDataMap = ref<Record<string, NetworkChartPoint[]>>({})
let networkPollingTimer: ReturnType<typeof setInterval> | null = null
const NETWORK_POLLING_INTERVAL_MS = 5_000
const MAX_NETWORK_POINTS = 60

function formatInterfaceLabel(name: string, index: number) {
  const value = name.trim()
  if (!value) {
    return `网卡 ${index + 1}`
  }

  // 兜底：若系统返回的名称存在乱码/不可见字符，仍保证下拉可读。
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
    {
      label: '所有网卡',
      value: ALL_INTERFACE_VALUE,
    },
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
  }
  catch {
    // 轮询场景下忽略异常，避免中断定时采集。
  }
  finally {
    isNetworkRequesting.value = false
    networkLoading.value = false
  }
}

function startNetworkPolling() {
  loadRealtimeNetworkStats()
  if (networkPollingTimer) {
    return
  }
  networkPollingTimer = setInterval(() => {
    loadRealtimeNetworkStats()
  }, NETWORK_POLLING_INTERVAL_MS)
}

function stopNetworkPolling() {
  if (!networkPollingTimer) {
    return
  }
  clearInterval(networkPollingTimer)
  networkPollingTimer = null
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
    <FaPageMain title="实时状态">
      <MonitorStatus :loading="loading" :info="systemInfo" />
    </FaPageMain>
    <FaPageMain title="系统信息">
      <MonitorSystemInfo :loading="loading" :info="systemInfo" />
    </FaPageMain>
    <FaPageMain title="网络监控">
      <MonitorNetwork
        v-model:selected-interface="selectedInterface"
        :loading="networkLoading"
        :interface-options="interfaceOptions"
        :chart-data-map="networkChartDataMap"
      />
    </FaPageMain>
  </div>
</template>
