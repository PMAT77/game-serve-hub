<script setup lang="ts">
import type { InstanceConnectInfo, InstanceConsoleLogLine, InstanceItem, InstanceMaintenancePushLog } from '@/api/modules/instance'
import apiInstance from '@/api/modules/instance'
import { routeToNodeInstance } from '@/navigation/game-routes'
import { copyTextToClipboard } from '@/utils/copyToClipboard'
import { getStatusLabel } from './instanceDisplay'
import { consoleLogShardLabel, formatConsoleLogLineForCopy } from './consoleLogDisplay'
import { formatDateTime } from './utils'
import type { InstanceConsoleCommandShard } from '@/api/modules/instance'
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NTooltip,
  useDialog,
} from 'naive-ui'

defineOptions({
  name: 'NodeInstanceConsole',
})

type ConsoleTab = 'logs' | 'panel' | 'maintenance'

const route = useRoute()
const router = useRouter()
const dialog = useDialog()
const appAccountStore = useAppAccountStore()

const instanceId = computed(() => String(route.params.instanceId ?? ''))
const instanceName = ref('')
const instanceStatus = ref<InstanceItem['status'] | null>(null)
const logs = ref<InstanceConsoleLogLine[]>([])
const connectInfo = ref<InstanceConnectInfo | null>(null)
const connectInfoLoading = ref(false)
const running = ref(false)
const activeTab = ref<ConsoleTab>('panel')
const commandInput = ref('')
const commandShard = ref<InstanceConsoleCommandShard>('master')
const commandSending = ref(false)
const maintenanceMessage = ref('')
const maintenanceDraftUpdatedAt = ref<string | null>(null)
const maintenancePushLogs = ref<InstanceMaintenancePushLog[]>([])
const maintenanceLoading = ref(false)
const maintenanceSaving = ref(false)
const maintenancePushing = ref(false)
const autoScroll = ref(true)
const logViewportLogsRef = ref<HTMLElement | null>(null)
const logViewportPanelRef = ref<HTMLElement | null>(null)

let eventSource: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | undefined
let connectInfoTimer: ReturnType<typeof setInterval> | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let streamRequestVersion = 0
let connectInfoRequest: Promise<void> | null = null
let logsRefreshRequest: Promise<void> | null = null
let realtimeActive = false
let initializing = false

const pageTitle = computed(() => instanceName.value
  ? `实例控制台 · ${instanceName.value}`
  : '实例控制台')

const gameLogs = computed(() => logs.value.filter(line => line.stream === 'stdout' || line.stream === 'stderr'))
const panelLogs = computed(() => logs.value.filter(line => line.stream === 'system'))

const displayedLogs = computed(() => {
  if (activeTab.value === 'panel') {
    return panelLogs.value
  }
  return gameLogs.value
})

const consoleShards = computed(() => connectInfo.value?.consoleShards)

const cavesCommandAvailable = computed(() => Boolean(
  consoleShards.value?.cavesConfigured && consoleShards.value?.cavesRunning,
))

const cavesCommandDisabledHint = computed(() => {
  if (!consoleShards.value?.cavesConfigured) {
    return '未启用洞穴'
  }
  if (!consoleShards.value.cavesRunning) {
    return '洞穴未运行'
  }
  return ''
})

const emptyLogHint = computed(() => {
  if (activeTab.value === 'panel') {
    return '暂无面板消息。命令回显与运行状态会显示在此。'
  }
  return '暂无运行日志。请先启动实例；地上与洞穴（若已开启）的输出将合并显示并带分片标签。'
})

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
  if (!autoScroll.value) {
    return
  }
  nextTick(() => {
    const el = activeTab.value === 'panel' ? logViewportPanelRef.value : logViewportLogsRef.value
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
  if (activeTab.value === 'logs' || activeTab.value === 'panel') {
    scrollToBottom()
  }
}

async function loadInstanceMeta() {
  const res = await apiInstance.getInstanceList()
  const list = res.data as InstanceItem[]
  const target = list.find((item: InstanceItem) => item.id === instanceId.value)
  if (!target) {
    faToast.warning('实例不存在或已删除')
    router.replace(routeToNodeInstance())
    return
  }
  instanceName.value = target.name
  instanceStatus.value = target.status
}

async function loadConnectInfo(options?: { silent?: boolean }) {
  if (!instanceId.value) {
    return
  }
  if (connectInfoRequest) {
    return connectInfoRequest
  }
  const targetInstanceId = instanceId.value
  const request = (async () => {
    if (!options?.silent) {
      connectInfoLoading.value = true
    }
    try {
      const res = await apiInstance.getInstanceConnectInfo(targetInstanceId)
      if (targetInstanceId !== instanceId.value) {
        return
      }
      connectInfo.value = res.data
      running.value = res.data.running
      if (!connectModeApplied) {
        connectModeApplied = true
        connectDisplayMode.value = res.data.preferredMode
      }
    }
    catch {
      if (targetInstanceId === instanceId.value) {
        connectInfo.value = null
      }
    }
    finally {
      if (!options?.silent) {
        connectInfoLoading.value = false
      }
    }
  })()
  connectInfoRequest = request
  try {
    await request
  }
  finally {
    if (connectInfoRequest === request) {
      connectInfoRequest = null
    }
  }
}

async function loadMaintenanceAnnounce() {
  if (!instanceId.value) {
    return
  }
  maintenanceLoading.value = true
  try {
    const res = await apiInstance.getInstanceMaintenanceAnnounce(instanceId.value)
    maintenanceMessage.value = res.data.draft.message
    maintenanceDraftUpdatedAt.value = res.data.draft.updatedAt
    maintenancePushLogs.value = res.data.recentPushes
  }
  catch {
    maintenancePushLogs.value = []
  }
  finally {
    maintenanceLoading.value = false
  }
}

async function saveMaintenanceDraft() {
  const message = maintenanceMessage.value.trim()
  if (!message) {
    faToast.warning('请先输入公告内容')
    return
  }
  maintenanceSaving.value = true
  try {
    const res = await apiInstance.saveInstanceMaintenanceAnnounceDraft(instanceId.value, message)
    maintenanceMessage.value = res.data.draft.message
    maintenanceDraftUpdatedAt.value = res.data.draft.updatedAt
    maintenancePushLogs.value = res.data.recentPushes
    faToast.success('公告草稿已保存')
  }
  finally {
    maintenanceSaving.value = false
  }
}

function confirmPushMaintenanceAnnounce() {
  const message = maintenanceMessage.value.trim()
  if (!message) {
    faToast.warning('请先输入公告内容')
    return
  }
  dialog.info({
    title: '推送到游戏房间',
    content: '将向主世界在线玩家广播此公告。确认推送？',
    positiveText: '确认推送',
    negativeText: '取消',
    onPositiveClick: () => pushMaintenanceAnnounce(message),
  })
}

async function pushMaintenanceAnnounce(message: string) {
  maintenancePushing.value = true
  try {
    const res = await apiInstance.pushInstanceMaintenanceAnnounce(instanceId.value, message)
    maintenancePushLogs.value = [
      res.data.pushLog,
      ...maintenancePushLogs.value.filter(item => item.id !== res.data.pushLog.id),
    ]
    if (res.data.isSuccess) {
      faToast.success('维护公告已推送到游戏房间')
      await refreshLogs()
      await loadMaintenanceAnnounce()
    }
    else {
      faToast.error(res.data.errorMessage ?? '推送失败')
    }
  }
  finally {
    maintenancePushing.value = false
  }
}

function formatMaintenancePushStatus(status: InstanceMaintenancePushLog['status']) {
  return status === 'success' ? '成功' : '失败'
}

function maintenancePushStatusTagType(status: InstanceMaintenancePushLog['status']) {
  return status === 'success' ? 'success' : 'error'
}

async function refreshLogs() {
  if (!instanceId.value) {
    return
  }
  if (logsRefreshRequest) {
    return logsRefreshRequest
  }
  const targetInstanceId = instanceId.value
  const request = (async () => {
    const lastId = logs.value.at(-1)?.id ?? 0
    const stream = activeTab.value === 'panel' ? 'panel' : 'game'
    const res = await apiInstance.getInstanceConsoleLogs(targetInstanceId, lastId, stream)
    if (targetInstanceId !== instanceId.value) {
      return
    }
    running.value = res.data.running
    appendLines(res.data.lines)
  })()
  logsRefreshRequest = request
  try {
    await request
  }
  finally {
    if (logsRefreshRequest === request) {
      logsRefreshRequest = null
    }
  }
}

async function connectStream() {
  if (!appAccountStore.isLogin || !instanceId.value) {
    return
  }
  const requestVersion = ++streamRequestVersion
  const targetInstanceId = instanceId.value
  eventSource?.close()
  eventSource = null
  let streamTicket: string
  try {
    const response = await apiInstance.createInstanceConsoleStreamTicket(targetInstanceId)
    streamTicket = response.data.ticket
  }
  catch {
    scheduleStreamReconnect()
    return
  }
  if (requestVersion !== streamRequestVersion || instanceId.value !== targetInstanceId) {
    return
  }
  const url = apiInstance.buildInstanceConsoleStreamUrl(targetInstanceId, streamTicket)
  const source = new EventSource(url)
  eventSource = source
  source.addEventListener('ready', (event) => {
    clearStreamReconnect()
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { running?: boolean }
      running.value = Boolean(payload.running)
    }
    catch {
      // ignore malformed payload
    }
  })
  source.addEventListener('log', (event) => {
    try {
      const line = JSON.parse((event as MessageEvent<string>).data) as InstanceConsoleLogLine
      appendLines([line])
    }
    catch {
      // ignore malformed payload
    }
  })
  source.onerror = () => {
    if (eventSource !== source) {
      return
    }
    source.close()
    eventSource = null
    scheduleStreamReconnect()
  }
}

function clearStreamReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
}

function scheduleStreamReconnect() {
  if (!realtimeActive || reconnectTimer || !appAccountStore.isLogin || !instanceId.value) {
    return
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    void connectStream()
  }, 3000)
}

function startRealtimeJobs() {
  realtimeActive = true
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void refreshLogs().catch(() => undefined)
    }, 5000)
  }
  if (!connectInfoTimer) {
    connectInfoTimer = setInterval(() => {
      void loadConnectInfo({ silent: true })
    }, 30000)
  }
}

function stopRealtimeJobs() {
  realtimeActive = false
  clearStreamReconnect()
  streamRequestVersion += 1
  eventSource?.close()
  eventSource = null
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
  if (connectInfoTimer) {
    clearInterval(connectInfoTimer)
    connectInfoTimer = undefined
  }
}

function resetInstanceRuntimeState() {
  instanceName.value = ''
  instanceStatus.value = null
  logs.value = []
  connectInfo.value = null
  connectModeApplied = false
  running.value = false
  maintenanceMessage.value = ''
  maintenanceDraftUpdatedAt.value = null
  maintenancePushLogs.value = []
  commandInput.value = ''
  commandShard.value = 'master'
}

async function initInstanceConsole() {
  if (!instanceId.value) {
    goBack()
    return
  }
  await loadInstanceMeta()
  await loadConnectInfo()
  await loadMaintenanceAnnounce()
  await refreshLogs()
}

async function activateConsole() {
  if (realtimeActive || initializing || !instanceId.value) {
    return
  }
  initializing = true
  try {
    await initInstanceConsole()
    void connectStream()
    startRealtimeJobs()
  }
  finally {
    initializing = false
  }
}

async function sendCommand(command?: string) {
  const text = (command ?? commandInput.value).trim()
  if (!text || commandSending.value) {
    return
  }
  commandSending.value = true
  try {
    await apiInstance.sendInstanceConsoleCommand(instanceId.value, text, commandShard.value)
    if (!command) {
      commandInput.value = ''
    }
    faToast.success('命令已发送')
  }
  finally {
    commandSending.value = false
  }
}

function confirmDangerousCommand(command: string, title: string, content: string) {
  dialog.warning({
    title,
    content,
    positiveText: '确认执行',
    negativeText: '取消',
    onPositiveClick: () => sendCommand(command),
  })
}

const quickCommands = [
  { label: '保存', command: 'c_save()' },
  { label: '回档 1 天', command: 'c_rollback(1)' },
  { label: '回档 2 天', command: 'c_rollback(2)' },
  { label: '回档 3 天', command: 'c_rollback(3)' },
]

async function clearLogs() {
  await apiInstance.clearInstanceConsoleLogs(instanceId.value)
  logs.value = []
}

async function copyLogs() {
  const source = activeTab.value === 'panel' ? panelLogs.value : gameLogs.value
  const text = source.map(line => formatConsoleLogLineForCopy(line)).join('\n')
  if (!text) {
    faToast.warning('暂无日志可复制')
    return
  }
  const ok = await copyTextToClipboard(text)
  if (!ok) {
    faToast.error('复制失败，请手动选中日志文本复制')
    return
  }
  faToast.success('日志已复制')
}

type ConnectCopyMode = 'public' | 'local' | 'lan'

const connectDisplayMode = ref<ConnectCopyMode>('public')
// 只在首次拿到 connectInfo 时套用面板推荐档位，避免轮询覆盖用户的手动切换
let connectModeApplied = false

const availableConnectModes: ConnectCopyMode[] = ['public', 'local', 'lan']

const connectDisplayBlock = computed(() => {
  const info = connectInfo.value
  if (!info) {
    return null
  }
  if (connectDisplayMode.value === 'local') {
    return {
      title: '本机进服',
      command: info.localCommand,
      hint: '游戏客户端与面板跑在同一台电脑时使用；面板运行在容器 / WSL2 里时，通常这一档最可靠。',
    }
  }
  if (connectDisplayMode.value === 'lan') {
    return {
      title: '局域网进服',
      command: info.lanCommand ?? '',
      hint: info.lanCommand
        ? '同一 WiFi / 内网的其他电脑；地址为当前探测结果，连不上请在服务器主机 ipconfig 核对 IPv4。'
        : '面板容器内看不到宿主机局域网网卡，未能自动探测局域网 IP。请在游戏服主机执行 ipconfig 查看 IPv4，或于环境配置中指定进服地址。',
    }
  }
  return {
    title: '公网 / 对外',
    command: info.command,
    hint: '适合云服务器，或已把 UDP 端口映射到本机的独立主机；地址来源见下方提示。',
  }
})

const canCopyConnectDisplay = computed(() => {
  const block = connectDisplayBlock.value
  return Boolean(block?.command?.trim())
})

const connectModeToggleTitle = computed(() => {
  const idx = availableConnectModes.indexOf(connectDisplayMode.value)
  const next = availableConnectModes[(idx + 1) % availableConnectModes.length]
  const nextLabel = next === 'local' ? '本机' : next === 'lan' ? '局域网' : '公网'
  return `切换为${nextLabel}直连命令`
})

function cycleConnectDisplayMode() {
  const idx = availableConnectModes.indexOf(connectDisplayMode.value)
  connectDisplayMode.value = availableConnectModes[(idx + 1) % availableConnectModes.length]!
}

async function copyConnectCommand(mode: ConnectCopyMode) {
  const info = connectInfo.value
  if (!info) {
    faToast.warning('暂无直连命令')
    return
  }
  const command = mode === 'local'
    ? info.localCommand
    : mode === 'lan'
      ? info.lanCommand
      : info.command
  if (!command?.trim()) {
    faToast.warning('暂无直连命令')
    return
  }
  const ok = await copyTextToClipboard(command)
  if (!ok) {
    faToast.error('复制失败，请手动选中命令文本复制')
    return
  }
  const label = mode === 'local' ? '本机直连' : mode === 'lan' ? '局域网直连' : '公网直连'
  faToast.success(`${label}命令已复制`)
}

const udpPortsLabel = computed(() => {
  const ports = connectInfo.value?.udpPorts
  if (!ports?.length) {
    return ''
  }
  return ports.join('、')
})

function goBack() {
  router.push(routeToNodeInstance())
}

watch(consoleShards, (shards) => {
  if (commandShard.value === 'caves' && shards && !shards.cavesRunning) {
    commandShard.value = 'master'
  }
})

watch(activeTab, (tab) => {
  if (tab === 'logs' || tab === 'panel') {
    scrollToBottom()
  }
})

watch(running, (value) => {
  if (value) {
    void loadConnectInfo()
  }
})

watch(instanceId, async (nextId, prevId) => {
  if (!nextId || nextId === prevId) {
    return
  }
  stopRealtimeJobs()
  resetInstanceRuntimeState()
  await activateConsole()
})

onMounted(() => {
  void activateConsole()
})

onActivated(() => {
  void activateConsole()
})

onDeactivated(() => {
  stopRealtimeJobs()
})

onBeforeUnmount(() => {
  stopRealtimeJobs()
})
</script>

<template>
  <FaPageMain :title="pageTitle">
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground max-w-3xl">
        查看连接信息、运行日志，并使用面板消息与 Lua 命令控制<strong>正在运行</strong>的实例。实例的启动与停止请返回
        <NButton text type="primary" size="tiny" class="align-baseline px-0" @click="goBack">
          实例管理
        </NButton>
        ；主机资源使用情况见「监控台」。
      </p>

      <div class="flex flex-wrap gap-2 items-center justify-between">
        <NSpace size="small">
          <NTag :type="running ? 'success' : 'default'" size="small">
            {{ running ? '运行中' : '未运行' }}
          </NTag>
          <span v-if="instanceStatus" class="text-xs text-muted-foreground">实例状态：{{ getStatusLabel(instanceStatus) }}</span>
        </NSpace>
        <FaButton variant="outline" size="sm" @click="goBack">
          返回实例列表
        </FaButton>
      </div>

      <NCard title="连接与加入" size="small">
        <NSpin v-if="connectInfoLoading && !connectInfo" class="block mx-auto my-6" />
        <template v-else-if="connectInfo">
          <NDescriptions :column="1" label-placement="left" size="small" class="mb-3">
            <NDescriptionsItem label="房间名">
              {{ connectInfo.roomName }}
            </NDescriptionsItem>
            <NDescriptionsItem label="联网模式">
              {{ connectInfo.networkModeLabel }}
            </NDescriptionsItem>
            <NDescriptionsItem label="连接地址">
              {{ connectInfo.host }}:{{ connectInfo.port }}
              <span class="text-muted-foreground ml-1">（{{ connectInfo.hostSourceLabel }}）</span>
            </NDescriptionsItem>
          </NDescriptions>
          <p class="text-xs text-muted-foreground mb-3 leading-relaxed">
            在游戏内按 ~ 打开控制台，粘贴下方命令。命令框右侧可复制当前命令，或切换公网 / 本机 / 局域网直连。
          </p>

          <template v-if="connectDisplayBlock">
            <p class="text-xs text-muted-foreground mb-1">
              {{ connectDisplayBlock.title }}
            </p>
            <div class="flex gap-2 items-stretch mb-1">
              <div
                class="min-w-0 flex-1 font-mono text-xs p-3 rounded-md bg-zinc-950 text-zinc-100 break-all min-h-10"
                :class="{ 'text-zinc-500': !connectDisplayBlock.command }"
              >
                {{ connectDisplayBlock.command || '暂无可用命令' }}
              </div>
              <div class="flex shrink-0 items-center gap-1 self-center">
                <NTooltip>
                  <template #trigger>
                    <NButton
                      quaternary
                      circle
                      size="small"
                      :disabled="!canCopyConnectDisplay"
                      @click="copyConnectCommand(connectDisplayMode)"
                    >
                      <FaIcon name="i-lucide:copy" class="size-4" />
                    </NButton>
                  </template>
                  复制当前直连命令
                </NTooltip>
                <NTooltip>
                  <template #trigger>
                    <NButton
                      quaternary
                      circle
                      size="small"
                      @click="cycleConnectDisplayMode"
                    >
                      <FaIcon name="i-ri:arrow-left-right-line" class="size-4" />
                    </NButton>
                  </template>
                  {{ connectModeToggleTitle }}
                </NTooltip>
              </div>
            </div>
            <p class="text-xs text-muted-foreground/80 mb-3 leading-relaxed">
              {{ connectDisplayBlock.hint }}
            </p>
          </template>

          <p v-if="udpPortsLabel" class="text-xs text-muted-foreground mb-2">
            直连进服需放行 UDP 端口：{{ udpPortsLabel }}。从游戏浏览列表进入不受此限制。
          </p>
          <ul
            v-if="connectInfo.hints.length > 0"
            class="text-xs text-muted-foreground list-disc pl-4 mb-3 space-y-1"
          >
            <li v-for="(hint, index) in connectInfo.hints" :key="index">
              {{ hint }}
            </li>
          </ul>
        </template>
        <p v-else class="text-sm text-muted-foreground">
          无法加载连接信息。
        </p>
      </NCard>

      <NTabs v-model:value="activeTab" type="line" animated>
        <NTabPane name="panel" tab="面板与控制">
          <div
            ref="logViewportPanelRef"
            class="font-mono text-xs leading-5 p-3 border rounded-lg bg-zinc-950 text-zinc-100 h-[min(52vh,560px)] overflow-y-auto mt-3"
          >
            <p v-if="displayedLogs.length === 0" class="text-zinc-500">
              {{ emptyLogHint }}
            </p>
            <div v-for="line in displayedLogs" :key="line.id" class="whitespace-pre-wrap break-all">
              <span class="text-zinc-500 mr-2">{{ formatDateTime(line.at) }}</span>
              <span
                v-if="line.shard"
                class="text-amber-400/90 mr-1.5"
              >[{{ consoleLogShardLabel(line.shard) }}]</span>
              <span :class="streamClass(line.stream)">{{ line.text }}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 items-center mt-3">
            <FaButton size="sm" variant="outline" @click="clearLogs">
              清空日志
            </FaButton>
            <FaButton size="sm" variant="outline" @click="copyLogs">
              复制日志
            </FaButton>
            <NSpace align="center" :size="8">
              <NSwitch v-model:value="autoScroll" size="small" />
              <span class="text-xs text-muted-foreground">自动滚动</span>
            </NSpace>
          </div>

          <div class="mt-6 pt-4 border-t border-border">
            <p class="text-xs text-muted-foreground mb-3">
              向游戏服务器发送控制台命令。命令回显显示在上方面板消息区。
            </p>
            <div class="flex flex-wrap gap-2 items-center mb-3">
              <span class="text-xs text-muted-foreground">命令发送到：</span>
              <NRadioGroup v-model:value="commandShard" size="small">
                <NRadioButton value="master" label="地上" />
                <NRadioButton
                  value="caves"
                  label="洞穴"
                  :disabled="!cavesCommandAvailable"
                />
              </NRadioGroup>
              <span v-if="cavesCommandDisabledHint" class="text-xs text-muted-foreground">
                （{{ cavesCommandDisabledHint }}）
              </span>
            </div>
            <p class="text-xs text-muted-foreground mb-4 leading-relaxed">
              改玩家属性、刷物品等命令需在玩家当前所在世界执行（人在洞穴时选「洞穴」）；保存、回档等命令通常只需选「地上」。
            </p>
            <NSpace class="mb-4" wrap>
              <NButton
                v-for="item in quickCommands"
                :key="item.command"
                size="small"
                :disabled="!running || commandSending"
                @click="sendCommand(item.command)"
              >
                {{ item.label }}
              </NButton>
              <NButton
                size="small"
                type="warning"
                :disabled="!running || commandSending"
                @click="confirmDangerousCommand('c_reset()', '确认重置世界？', '将立即重新生成一个全新世界：当前世界的地形、建筑与玩家物品都会丢失且不可恢复（已保存的回档快照除外）。真的要继续吗？')"
              >
                重置世界
              </NButton>
            </NSpace>
            <form class="flex gap-2 items-start" @submit.prevent="sendCommand()">
              <FaInput
                v-model="commandInput"
                class="flex-1 font-mono"
                placeholder="例如 c_save() 或 TheNet:Announce('hello')"
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
        </NTabPane>
        
        <NTabPane name="logs" tab="运行日志">
          <div
            ref="logViewportLogsRef"
            class="font-mono text-xs leading-5 p-3 border rounded-lg bg-zinc-950 text-zinc-100 h-[min(52vh,560px)] overflow-y-auto mt-3"
          >
            <p v-if="displayedLogs.length === 0" class="text-zinc-500">
              {{ emptyLogHint }}
            </p>
            <div v-for="line in displayedLogs" :key="line.id" class="whitespace-pre-wrap break-all">
              <span class="text-zinc-500 mr-2">{{ formatDateTime(line.at) }}</span>
              <span
                v-if="line.shard"
                class="text-amber-400/90 mr-1.5"
              >[{{ consoleLogShardLabel(line.shard) }}]</span>
              <span :class="streamClass(line.stream)">{{ line.text }}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 items-center mt-3">
            <FaButton size="sm" variant="outline" @click="clearLogs">
              清空日志
            </FaButton>
            <FaButton size="sm" variant="outline" @click="copyLogs">
              复制日志
            </FaButton>
            <NSpace align="center" :size="8">
              <NSwitch v-model:value="autoScroll" size="small" />
              <span class="text-xs text-muted-foreground">自动滚动</span>
            </NSpace>
          </div>
        </NTabPane>

        <NTabPane name="maintenance" tab="维护公告">
          <p class="text-xs text-muted-foreground mt-3 mb-4 leading-relaxed max-w-3xl">
            向游戏内在线玩家推送公告。常见用法：面板升级或维护前先通知玩家（游戏服可继续运行）。
          </p>
          <NInput
            v-model:value="maintenanceMessage"
            type="textarea"
            placeholder="例如：10 分钟后面板升级，游戏服保持在线，暂无法打开管理页"
            :disabled="maintenanceLoading || maintenanceSaving || maintenancePushing"
            :maxlength="500"
            show-count
            :autosize="{ minRows: 4, maxRows: 8 }"
            class="mb-3"
          />
          <p v-if="maintenanceDraftUpdatedAt" class="text-xs text-muted-foreground mb-3">
            草稿上次保存：{{ formatDateTime(maintenanceDraftUpdatedAt) }}
          </p>
          <NSpace class="mb-6" justify="start" wrap>
            <NButton
              size="small"
              :loading="maintenanceSaving"
              :disabled="maintenanceLoading || maintenancePushing"
              @click="saveMaintenanceDraft"
            >
              保存草稿
            </NButton>
            <NButton
              size="small"
              type="primary"
              :loading="maintenancePushing"
              :disabled="!running || maintenanceLoading || maintenanceSaving"
              @click="confirmPushMaintenanceAnnounce"
            >
              推送到房间
            </NButton>
          </NSpace>
          <p class="text-xs text-muted-foreground mb-2">
            最近推送记录
          </p>
          <NEmpty
            v-if="!maintenanceLoading && maintenancePushLogs.length === 0"
            description="暂无推送记录"
            size="small"
            class="py-4"
          />
          <div v-else class="space-y-2 max-h-[min(48vh,520px)] overflow-y-auto">
            <div
              v-for="item in maintenancePushLogs"
              :key="item.id"
              class="rounded-md border border-border px-3 py-2 text-xs"
            >
              <div class="flex flex-wrap gap-2 items-center mb-1">
                <NTag :type="maintenancePushStatusTagType(item.status)" size="small">
                  {{ formatMaintenancePushStatus(item.status) }}
                </NTag>
                <span class="text-muted-foreground">{{ formatDateTime(item.pushedAt) }}</span>
                <span class="text-muted-foreground">· {{ item.operatorAccount }}</span>
              </div>
              <p class="whitespace-pre-wrap break-all">
                {{ item.message }}
              </p>
              <p v-if="item.errorMessage" class="text-rose-500 mt-1">
                {{ item.errorMessage }}
              </p>
            </div>
          </div>
        </NTabPane>
      </NTabs>

      <p class="text-xs text-muted-foreground">
        实例 ID：{{ instanceId }}
      </p>
    </div>
  </FaPageMain>
</template>
