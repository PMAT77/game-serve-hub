<script setup lang="ts">
import type { InstanceConnectInfo, InstanceConsoleLogLine, InstanceItem } from '@/api/modules/instance'
import apiInstance from '@/api/modules/instance'
import { formatDateTime } from './utils'
import type { InstanceConsoleCommandShard } from '@/api/modules/instance'
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NTabPane,
  NTabs,
  NTag,
  useDialog,
} from 'naive-ui'

defineOptions({
  name: 'NodeInstanceConsole',
})

type ConsoleTab = 'logs' | 'panel'

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
const autoScroll = ref(true)
const logViewportLogsRef = ref<HTMLElement | null>(null)
const logViewportPanelRef = ref<HTMLElement | null>(null)

let eventSource: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | undefined
let connectInfoTimer: ReturnType<typeof setInterval> | undefined

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
  return '暂无运行日志。请先启动实例；DST 进程输出将在此显示。'
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
    router.replace({ name: 'nodeInstance' })
    return
  }
  instanceName.value = target.name
  instanceStatus.value = target.status
}

async function loadConnectInfo() {
  if (!instanceId.value) {
    return
  }
  connectInfoLoading.value = true
  try {
    const res = await apiInstance.getInstanceConnectInfo(instanceId.value)
    connectInfo.value = res.data
    running.value = res.data.running
  }
  catch {
    connectInfo.value = null
  }
  finally {
    connectInfoLoading.value = false
  }
}

async function refreshLogs() {
  const lastId = logs.value.at(-1)?.id ?? 0
  const stream = activeTab.value === 'panel' ? 'panel' : 'game'
  const res = await apiInstance.getInstanceConsoleLogs(instanceId.value, lastId, stream)
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
  const text = source.map(line => line.text).join('\n')
  if (!text) {
    faToast.warning('暂无日志可复制')
    return
  }
  await navigator.clipboard.writeText(text)
  faToast.success('日志已复制')
}

type ConnectCopyMode = 'public' | 'local' | 'lan'

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
  if (!command) {
    faToast.warning('暂无直连命令')
    return
  }
  await navigator.clipboard.writeText(command)
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
  router.push({ name: 'nodeInstance' })
}

watch(consoleShards, (shards) => {
  if (commandShard.value === 'caves' && shards && !shards.cavesRunning) {
    commandShard.value = 'master'
  }
})

watch(activeTab, () => {
  scrollToBottom()
})

watch(running, (value) => {
  if (value) {
    void loadConnectInfo()
  }
})

onMounted(async () => {
  if (!instanceId.value) {
    goBack()
    return
  }
  await loadInstanceMeta()
  await loadConnectInfo()
  await refreshLogs()
  connectStream()
  pollTimer = setInterval(() => {
    void refreshLogs()
  }, 5000)
  connectInfoTimer = setInterval(() => {
    void loadConnectInfo()
  }, 30000)
})

onBeforeUnmount(() => {
  eventSource?.close()
  eventSource = null
  if (pollTimer) {
    clearInterval(pollTimer)
  }
  if (connectInfoTimer) {
    clearInterval(connectInfoTimer)
  }
})
</script>

<template>
  <FaPageMain :title="pageTitle">
    <div class="space-y-4">
      <p class="text-xs text-muted-foreground max-w-3xl">
        面向<strong>已启动实例</strong>的饥荒运行时：连接信息、运行日志，以及面板消息与 Lua 控制（同页上下布局）。实例启停与安装请返回
        <button type="button" class="text-primary underline-offset-2 hover:underline" @click="goBack">
          实例列表
        </button>
        ；主机资源请使用监控台（非本页）。
      </p>

      <div class="flex flex-wrap gap-2 items-center justify-between">
        <NSpace size="small">
          <NTag :type="running ? 'success' : 'default'" size="small">
            {{ running ? '运行中' : '未运行' }}
          </NTag>
          <span v-if="instanceStatus" class="text-xs text-muted-foreground">实例状态：{{ instanceStatus }}</span>
        </NSpace>
        <FaButton variant="outline" size="sm" @click="goBack">
          返回实例列表
        </FaButton>
      </div>

      <NCard title="连接与加入" size="small">
        <template v-if="connectInfoLoading && !connectInfo">
          <p class="text-sm text-muted-foreground">
            正在加载连接信息…
          </p>
        </template>
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
            在游戏内按 ~ 打开控制台，粘贴下方命令。外网玩家用公网直连；局域网内其他电脑用局域网地址（多为
            <span class="font-mono">192.168.x.x</span>，以服务器所在电脑的 ipconfig 为准，每台网络不同）。
          </p>

          <p class="text-xs text-muted-foreground mb-1">
            公网 / 对外：
          </p>
          <div class="font-mono text-xs p-3 rounded-md bg-zinc-950 text-zinc-100 break-all mb-1">
            {{ connectInfo.command }}
          </div>
          <p class="text-xs text-muted-foreground/80 mb-3">
            适合外网或云服务器；本机 WSL2 / Docker 开发时此地址往往无法直连。
          </p>

          <p class="text-xs text-muted-foreground mb-1">
            本机进服（仅游戏装在与面板同一台电脑）：
          </p>
          <div class="font-mono text-xs p-3 rounded-md bg-zinc-950 text-zinc-100 break-all mb-3">
            {{ connectInfo.localCommand }}
          </div>

          <p class="text-xs text-muted-foreground mb-1">
            局域网进服（同一 WiFi / 内网的其他电脑）：
          </p>
          <template v-if="connectInfo.lanCommand">
            <div class="font-mono text-xs p-3 rounded-md bg-zinc-950 text-zinc-100 break-all mb-1">
              {{ connectInfo.lanCommand }}
            </div>
            <p class="text-xs text-muted-foreground/80 mb-3">
              为当前探测到的局域网地址；若连不上，请在服务器主机上执行 ipconfig 核对 IPv4（每台电脑的 192.168.x.x 可能不同）。
            </p>
          </template>
          <p v-else class="text-xs text-muted-foreground/80 mb-3 leading-relaxed">
            面板未能自动探测到局域网 IP。请在运行游戏服的 Windows 主机上执行
            <span class="font-mono">ipconfig</span>
            查看 IPv4（常见为 192.168.0.x / 192.168.1.x，因网络而异），手动替换公网命令中的 IP；若仍无法识别，可在面板环境配置中指定进服地址。
          </p>

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
          <NSpace size="small" wrap>
            <FaButton
              size="sm"
              variant="default"
              :disabled="connectInfo.isPlaceholder"
              @click="copyConnectCommand('public')"
            >
              复制公网直连
            </FaButton>
            <FaButton
              size="sm"
              variant="outline"
              @click="copyConnectCommand('local')"
            >
              复制本机直连
            </FaButton>
            <FaButton
              v-if="connectInfo.lanCommand"
              size="sm"
              variant="outline"
              @click="copyConnectCommand('lan')"
            >
              复制局域网直连
            </FaButton>
          </NSpace>
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
            <label class="text-xs text-muted-foreground flex gap-1.5 items-center">
              <input v-model="autoScroll" type="checkbox" class="accent-primary">
              自动滚动
            </label>
          </div>

          <div class="mt-6 pt-4 border-t border-border">
            <p class="text-xs text-muted-foreground mb-3">
              向游戏服务器发送控制台命令。命令回显显示在上方面板消息区。
            </p>
            <div class="flex flex-wrap gap-2 items-center mb-3">
              <span class="text-xs text-muted-foreground">命令发送到：</span>
              <NRadioGroup v-model:value="commandShard" size="small">
                <NRadioButton value="master" label="主世界" />
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
              改玩家属性、刷物品等命令需在玩家当前所在世界执行（人在洞穴时选「洞穴」）；保存、回档等命令通常只需选「主世界」。
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
                @click="confirmDangerousCommand('c_reset()', '重置世界', '将重置当前世界进度，所有玩家将受影响。确认执行？')"
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
            <label class="text-xs text-muted-foreground flex gap-1.5 items-center">
              <input v-model="autoScroll" type="checkbox" class="accent-primary">
              自动滚动
            </label>
          </div>
        </NTabPane>
      </NTabs>

      <p class="text-xs text-muted-foreground">
        实例 ID：{{ instanceId }}
      </p>
    </div>
  </FaPageMain>
</template>
