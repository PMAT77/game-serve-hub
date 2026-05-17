<script setup lang="ts">
import type { InstanceConsoleLogLine, InstanceItem } from '@/api/modules/instance'
import apiInstance from '@/api/modules/instance'
import { formatDateTime } from './utils'

defineOptions({
  name: 'NodeInstanceConsole',
})

const route = useRoute()
const router = useRouter()
const appAccountStore = useAppAccountStore()

const instanceId = computed(() => String(route.params.instanceId ?? ''))
const instanceName = ref('')
const instanceStatus = ref<InstanceItem['status'] | null>(null)
const logs = ref<InstanceConsoleLogLine[]>([])
const running = ref(false)
const commandInput = ref('')
const commandSending = ref(false)
const autoScroll = ref(true)
const logViewportRef = ref<HTMLElement | null>(null)

let eventSource: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | undefined

const pageTitle = computed(() => instanceName.value
  ? `实例控制台 · ${instanceName.value}`
  : '实例控制台')

function streamClass(stream: InstanceConsoleLogLine['stream']) {
  switch (stream) {
    case 'stderr':
      return 'text-rose-400'
    case 'system':
      return 'text-sky-400'
    default:
      return 'text-foreground/90'
  }
}

function scrollToBottom() {
  if (!autoScroll.value || !logViewportRef.value) {
    return
  }
  nextTick(() => {
    const el = logViewportRef.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

function appendLines(lines: InstanceConsoleLogLine[]) {
  if (lines.length === 0) {
    return
  }
  const existing = new Set(logs.value.map(item => item.id))
  const merged = [...logs.value]
  for (const line of lines) {
    if (!existing.has(line.id)) {
      merged.push(line)
      existing.add(line.id)
    }
  }
  logs.value = merged
  scrollToBottom()
}

async function loadInstanceMeta() {
  const res = await apiInstance.getInstanceList()
  const list = res.data as InstanceItem[]
  const target = list.find((item: InstanceItem) => item.id === instanceId.value)
  if (!target) {
    faToast.warning('实例不存在或已删除')
    router.replace({ name: 'nodeInstance' })
    return
  }
  instanceName.value = target.name
  instanceStatus.value = target.status
}

async function refreshLogs() {
  const lastId = logs.value.at(-1)?.id ?? 0
  const res = await apiInstance.getInstanceConsoleLogs(instanceId.value, lastId)
  running.value = res.data.running
  appendLines(res.data.lines)
}

function connectStream() {
  if (!appAccountStore.token) {
    return
  }
  eventSource?.close()
  const url = apiInstance.buildInstanceConsoleStreamUrl(instanceId.value, appAccountStore.token)
  eventSource = new EventSource(url)
  eventSource.addEventListener('ready', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { running?: boolean }
      running.value = Boolean(payload.running)
    }
    catch {
      // ignore malformed payload
    }
  })
  eventSource.addEventListener('log', (event) => {
    try {
      const line = JSON.parse((event as MessageEvent<string>).data) as InstanceConsoleLogLine
      appendLines([line])
    }
    catch {
      // ignore malformed payload
    }
  })
  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
  }
}

async function sendCommand() {
  if (commandSending.value) {
    return
  }
  const command = commandInput.value.trim()
  if (!command) {
    return
  }
  commandSending.value = true
  try {
    await apiInstance.sendInstanceConsoleCommand(instanceId.value, command)
    commandInput.value = ''
  }
  finally {
    commandSending.value = false
  }
}

async function clearLogs() {
  await apiInstance.clearInstanceConsoleLogs(instanceId.value)
  logs.value = []
}

async function copyLogs() {
  const text = logs.value.map(line => line.text).join('\n')
  if (!text) {
    faToast.warning('暂无日志可复制')
    return
  }
  await navigator.clipboard.writeText(text)
  faToast.success('日志已复制')
}

function goBack() {
  router.push({ name: 'nodeInstance' })
}

onMounted(async () => {
  if (!instanceId.value) {
    goBack()
    return
  }
  await loadInstanceMeta()
  await refreshLogs()
  connectStream()
  pollTimer = setInterval(() => {
    void refreshLogs()
  }, 5000)
})

onBeforeUnmount(() => {
  eventSource?.close()
  eventSource = null
  if (pollTimer) {
    clearInterval(pollTimer)
  }
})
</script>

<template>
  <FaPageMain :title="pageTitle">
    <div class="space-y-3">
      <div class="flex flex-wrap gap-3 items-start justify-between">
        <p class="text-xs text-muted-foreground max-w-3xl">
          游戏实例运行时控制台（非主机监控台 `/console/monitor`）。支持实时日志、命令下发；饥荒 DST 等服务端需以 `-console` 启动。
        </p>
        <div class="flex flex-wrap gap-2 items-center">
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :class="running ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'"
          >
            {{ running ? '运行中' : '未运行' }}
          </span>
          <FaButton variant="outline" size="sm" @click="goBack">
            返回实例列表
          </FaButton>
        </div>
      </div>

      <div class="text-xs text-muted-foreground flex flex-wrap gap-3">
        <span>实例 ID：{{ instanceId }}</span>
        <span v-if="instanceStatus">状态：{{ instanceStatus }}</span>
      </div>

      <div
        ref="logViewportRef"
        class="font-mono text-xs leading-5 p-3 border rounded-lg bg-zinc-950 text-zinc-100 h-[min(58vh,640px)] overflow-y-auto"
      >
        <p v-if="logs.length === 0" class="text-zinc-500">
          暂无控制台输出。请先启动实例；启动后日志将在此实时显示。
        </p>
        <div v-for="line in logs" :key="line.id" class="whitespace-pre-wrap break-all">
          <span class="text-zinc-500 mr-2">{{ formatDateTime(line.at) }}</span>
          <span :class="streamClass(line.stream)">{{ line.text }}</span>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 items-center">
        <FaButton size="sm" variant="outline" @click="clearLogs">
          清空日志
        </FaButton>
        <FaButton size="sm" variant="outline" @click="copyLogs">
          复制日志
        </FaButton>
        <label class="text-xs text-muted-foreground flex gap-1.5 items-center">
          <input v-model="autoScroll" type="checkbox" class="accent-primary">
          自动滚动
        </label>
      </div>

      <form class="flex gap-2 items-start" @submit.prevent="sendCommand">
        <FaInput
          v-model="commandInput"
          class="flex-1 font-mono"
          placeholder="输入控制台命令，例如 c_save() 或 /say hello"
          :disabled="!running || commandSending"
        />
        <FaButton
          type="submit"
          variant="default"
          :loading="commandSending"
          :disabled="!running || commandSending"
        >
          发送
        </FaButton>
      </form>
    </div>
  </FaPageMain>
</template>
