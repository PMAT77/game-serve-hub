<script setup lang="ts">
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NCard, NProgress, NStatistic, NTooltip } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { routeToInstanceConsole } from '@/navigation/game-routes'
import { statusBadgeClass } from '@/constants/statusDictionary'
import {
  computeUptimeSecondsFromStartedAt,
  extractInstallProgressPercent,
  formatMemoryMb,
  formatUptime,
  getInstanceState,
  isInstanceInstallingStatus,
  resolveInstallPhase,
  shouldShowInstallDetail,
} from '../../instanceDisplay'
import {
  canUpdateInstance,
  getUpdateInstanceButtonTitle,
  useInstanceLifecycleActions,
} from '../../composables/useInstanceLifecycleActions'
import { useInstanceRuntimeObservability } from '../../composables/useInstanceRuntimeObservability'

defineOptions({
  name: 'InstanceDetailControlCard',
})

const props = defineProps<{
  instance: InstanceItem | null
}>()

const emit = defineEmits<{
  refreshed: []
}>()

const router = useRouter()

const {
  isActionLoading,
  isInstanceActionRunning,
  confirmStartInstance,
  confirmUpdateInstance,
  confirmDangerousInstanceAction,
} = useInstanceLifecycleActions({
  refresh: () => emit('refreshed'),
})

/** 单实例指标轮询（复用列表页同一套可观测性实现） */
const instanceListRef = computed(() => (props.instance ? [props.instance] : []))
const {
  uptimeNowMs,
  syncRuntimeObservabilityPolling,
  stopRuntimeObservability,
  getMetricsForInstance,
} = useInstanceRuntimeObservability(instanceListRef)

watch(() => props.instance?.status, () => syncRuntimeObservabilityPolling())
onMounted(() => syncRuntimeObservabilityPolling())
onBeforeUnmount(() => stopRuntimeObservability())

const state = computed(() => (props.instance ? getInstanceState(props.instance) : null))
const actionRunning = computed(() => Boolean(props.instance && isInstanceActionRunning(props.instance.id)))

const isInstalling = computed(() => Boolean(props.instance && isInstanceInstallingStatus(props.instance.status)))

const installProgress = computed(() => (props.instance ? extractInstallProgressPercent(props.instance) : null))

const metrics = computed(() => (props.instance ? getMetricsForInstance(props.instance.id) : null))

const uptimeSeconds = computed(() => {
  if (!props.instance || props.instance.status !== 'running') {
    return null
  }
  const metricsUptime = metrics.value?.uptimeSeconds ?? null
  if (metricsUptime !== null) {
    return metricsUptime
  }
  return computeUptimeSecondsFromStartedAt(props.instance.runtimeStartedAt, uptimeNowMs.value)
})

function canStart() {
  if (!props.instance) {
    return false
  }
  return !actionRunning.value
    && props.instance.status !== 'running'
    && props.instance.status !== 'pending_install'
    && props.instance.status !== 'installing'
}

function canStop() {
  if (!props.instance) {
    return false
  }
  return !actionRunning.value
    && props.instance.status !== 'stopped'
    && props.instance.status !== 'error'
}

function canRestart() {
  if (!props.instance) {
    return false
  }
  return !actionRunning.value
    && props.instance.status !== 'pending_install'
    && props.instance.status !== 'installing'
}

function canDelete() {
  if (!props.instance) {
    return false
  }
  return !actionRunning.value
    && props.instance.status !== 'pending_install'
    && props.instance.status !== 'installing'
}

/** 更新动作按当前状态给出确认语义（修复安装 vs 更新） */
function requestUpdate() {
  if (props.instance) {
    confirmUpdateInstance(props.instance)
  }
}

function requestDangerous(action: 'stop' | 'cancel_install' | 'restart' | 'delete') {
  if (props.instance) {
    confirmDangerousInstanceAction(props.instance, action)
  }
}

function goConsole() {
  if (props.instance) {
    router.push(routeToInstanceConsole(props.instance.id))
  }
}
</script>

<template>
  <NCard title="实例控制" size="small">
    <template v-if="instance && state">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <span
          class="text-xs px-2 py-0.5 rounded-full"
          :class="statusBadgeClass(state.tone)"
        >
          {{ state.label }}
        </span>
        <span v-if="instance.updateAvailable" class="text-xs text-amber-600 dark:text-amber-400">
          服务端有新版本
        </span>
      </div>

      <p
        v-if="instance.lastError?.trim() && !isInstalling"
        class="mb-4 rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground break-all"
      >
        {{ instance.lastError }}
      </p>

      <div v-if="shouldShowInstallDetail(instance)" class="mb-4 space-y-1">
        <div class="flex justify-between text-xs text-muted-foreground">
          <span>安装进度</span>
          <span v-if="installProgress != null">{{ installProgress }}%</span>
          <span v-else>处理中</span>
        </div>
        <NProgress
          v-if="installProgress != null"
          :percentage="installProgress"
          :show-indicator="false"
          :processing="isInstalling"
          :height="8"
        />
        <p class="text-xs text-muted-foreground">
          {{ resolveInstallPhase(instance) }}
        </p>
      </div>

      <div class="grid grid-cols-3 gap-x-4 gap-y-3 mb-4">
        <NStatistic label="CPU（进程）">
          {{ instance.status === 'running' && metrics?.cpuUsageRate != null ? `${metrics.cpuUsageRate.toFixed(1)}%` : '—' }}
        </NStatistic>
        <NStatistic label="内存（RSS）">
          {{ instance.status === 'running' ? formatMemoryMb(metrics?.memoryMb) : '—' }}
        </NStatistic>
        <NStatistic label="运行时长">
          {{ formatUptime(uptimeSeconds) }}
        </NStatistic>
      </div>

      <div class="flex flex-wrap gap-2">
        <NButton
          size="small"
          type="primary"
          secondary
          :loading="isActionLoading(instance.id, 'start')"
          :disabled="!canStart()"
          @click="confirmStartInstance(instance)"
        >
          启动
        </NButton>
        <NButton
          size="small"
          type="warning"
          secondary
          :loading="isActionLoading(instance.id, 'stop')"
          :disabled="!canStop()"
          @click="requestDangerous(instance.status === 'installing' || instance.status === 'pending_install' ? 'cancel_install' : 'stop')"
        >
          {{ isInstalling ? '取消安装' : '停止' }}
        </NButton>
        <NButton
          size="small"
          secondary
          :loading="isActionLoading(instance.id, 'restart')"
          :disabled="!canRestart()"
          @click="requestDangerous('restart')"
        >
          重启
        </NButton>
        <NTooltip trigger="hover" :disabled="canUpdateInstance(instance)">
          <template #trigger>
            <NButton
              size="small"
              type="warning"
              secondary
              :loading="isActionLoading(instance.id, 'update')"
              :disabled="actionRunning || !canUpdateInstance(instance)"
              @click="requestUpdate"
            >
              {{ state.key === 'install_failed' ? '修复安装' : '更新服务端' }}
            </NButton>
          </template>
          {{ getUpdateInstanceButtonTitle(instance) }}
        </NTooltip>
        <NButton size="small" secondary :disabled="isInstalling" @click="goConsole">
          控制台
        </NButton>
        <NButton
          size="small"
          type="error"
          secondary
          :disabled="!canDelete()"
          @click="requestDangerous('delete')"
        >
          删除
        </NButton>
      </div>
    </template>
    <p v-else class="text-sm text-muted-foreground">
      未找到实例。
    </p>
  </NCard>
</template>
