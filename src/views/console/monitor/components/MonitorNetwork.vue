<script setup lang="ts">
import type { EChartsOption } from 'echarts'
import type { MonitorNetworkOption, NetworkChartPoint } from './types'
import * as echarts from 'echarts'
import { NSelect } from 'naive-ui'

defineOptions({
  name: 'MonitorNetwork',
})

const props = defineProps<{
  loading: boolean
  selectedInterface: string | null
  interfaceOptions: MonitorNetworkOption[]
  chartDataMap: Record<string, NetworkChartPoint[]>
}>()

const emit = defineEmits<{
  'update:selectedInterface': [value: string | null]
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null

const selectedInterfaceModel = computed<string | null>({
  get() {
    return props.selectedInterface
  },
  set(value) {
    emit('update:selectedInterface', value)
  },
})

const activeChartData = computed(() => {
  if (!props.selectedInterface) {
    return []
  }
  return props.chartDataMap[props.selectedInterface] ?? []
})

function formatNetworkSpeed(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 * 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024 / 1024).toFixed(2)} GB/s`
  }
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`
  }
  return `${bytesPerSecond.toFixed(2)} B/s`
}

type NetworkSpeedUnit = 'B' | 'KB' | 'MB' | 'GB'

function getNetworkSpeedUnit(maxBytesPerSecond: number): NetworkSpeedUnit {
  if (maxBytesPerSecond >= 1024 * 1024 * 1024) {
    return 'GB'
  }
  if (maxBytesPerSecond >= 1024 * 1024) {
    return 'MB'
  }
  if (maxBytesPerSecond >= 1024) {
    return 'KB'
  }
  return 'B'
}

function formatNetworkValueByUnit(bytesPerSecond: number, unit: NetworkSpeedUnit) {
  const divisors: Record<NetworkSpeedUnit, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  }
  return (bytesPerSecond / divisors[unit]).toFixed(2)
}

function initChart() {
  if (!chartRef.value) {
    return
  }
  if (chartInstance && chartInstance.getDom() !== chartRef.value) {
    disposeChart()
  }
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }
  renderChart()
}

function disposeChart() {
  chartInstance?.dispose()
  chartInstance = null
}

function resizeChart() {
  chartInstance?.resize()
}

function renderChart() {
  if (!chartInstance) {
    return
  }
  if (!chartInstance.getDom()?.isConnected) {
    disposeChart()
    return
  }

  const xAxisData = activeChartData.value.map(item => item.time)
  const uploadData = activeChartData.value.map(item => item.upBps)
  const downloadData = activeChartData.value.map(item => item.downBps)
  const maxNetworkSpeed = Math.max(0, ...uploadData, ...downloadData)
  const yAxisUnit = getNetworkSpeedUnit(maxNetworkSpeed)

  const option: EChartsOption = {
    animation: false,
    legend: {
      top: 4,
      right: 0,
      data: ['上行', '下行'],
    },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      valueFormatter(value) {
        if (typeof value !== 'number') {
          return `${value ?? '--'}`
        }
        return formatNetworkSpeed(value)
      },
    },
    grid: {
      top: 58,
      left: 12,
      right: 12,
      bottom: 68,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: xAxisData,
      axisLabel: {
        color: '#94a3b8',
      },
    },
    yAxis: {
      type: 'value',
      name: `${yAxisUnit}/s`,
      nameLocation: 'end',
      nameRotate: 0,
      nameGap: 8,
      nameTextStyle: {
        color: '#94a3b8',
      },
      axisLabel: {
        color: '#94a3b8',
        formatter(value) {
          return formatNetworkValueByUnit(Number(value), yAxisUnit)
        },
      },
      splitLine: {
        lineStyle: {
          type: 'dashed',
        },
      },
    },
    dataZoom: [
      {
        type: 'inside',
      },
      {
        type: 'slider',
        bottom: 12,
        height: 20,
      },
    ],
    series: [
      {
        name: '上行',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: uploadData,
        lineStyle: {
          width: 2,
        },
      },
      {
        name: '下行',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: downloadData,
        lineStyle: {
          width: 2,
        },
      },
    ],
  }

  chartInstance.setOption(option, true)
}

watch(
  () => [props.selectedInterface, activeChartData.value.length],
  () => {
    nextTick(() => {
      initChart()
      resizeChart()
    })
  },
)

watch(chartRef, (element) => {
  if (element) {
    nextTick(() => {
      initChart()
      resizeChart()
    })
    return
  }
  disposeChart()
})

onMounted(() => {
  window.addEventListener('resize', resizeChart)
})

onActivated(() => {
  window.addEventListener('resize', resizeChart)
  nextTick(() => {
    initChart()
    resizeChart()
  })
})

onDeactivated(() => {
  window.removeEventListener('resize', resizeChart)
  disposeChart()
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeChart)
  disposeChart()
})
</script>

<template>
  <div class="p-4 border rounded-lg">
    <div class="mb-6 flex gap-4 items-center justify-between">
      <div class="text-sm text-muted-foreground">
        实时网卡吞吐
      </div>
      <NSelect
        v-model:value="selectedInterfaceModel"
        class="max-w-full w-72"
        :options="props.interfaceOptions"
        placeholder="请选择网卡"
        :disabled="props.loading || props.interfaceOptions.length === 0"
      />
    </div>

    <div v-if="props.interfaceOptions.length === 0" class="flex h-90 items-center justify-center">
      <NEmpty description="暂无可用网卡数据" />
    </div>
    <div v-else ref="chartRef" class="h-90 w-full" />
  </div>
</template>
