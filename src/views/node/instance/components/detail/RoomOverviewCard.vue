<script setup lang="ts">
import type { InstanceItem } from '@/api/modules/instance'
import type { ClusterConfigDto, ClusterOnlinePlayersDto } from '@/api/modules/cluster'
import type { ModListDto } from '@/api/modules/mod'
import type { InstanceConnectInfo } from '@/api/modules/instance'
import { NButton, NCard, NEmpty, NSpin, NStatistic, NTag } from 'naive-ui'
import { computed } from 'vue'
import {
  routeToDstModList,
  routeToDstPlayerManage,
  routeToDstRoomSettings,
  routeToDstWorldSettings,
  routeToInstanceConsole,
} from '@/navigation/game-routes'
import { instanceSupportsDstRoom } from '@/composables/useGameInstance'
import { dstGameModeLabel } from '../../instanceCommandShortcuts'

defineOptions({
  name: 'InstanceDetailRoomOverviewCard',
})

const props = defineProps<{
  instance: InstanceItem | null
  cluster: ClusterConfigDto | null
  onlinePlayers: ClusterOnlinePlayersDto | null
  modList: ModListDto | null
  connectInfo: InstanceConnectInfo | null
  loading?: boolean
}>()

const router = useRouter()

const isDst = computed(() => Boolean(props.instance && instanceSupportsDstRoom(props.instance)))
const installed = computed(() => Boolean(
  props.instance
  && props.instance.status !== 'pending_install'
  && props.instance.status !== 'installing',
))

const roomName = computed(() => props.cluster?.clusterName?.trim() || props.connectInfo?.roomName || '—')

/**
 * 联网模式只显示模式本身。
 *
 * 后端标签是给控制台「连接与加入」卡片用的，带了括号补充（例如「公网（Klei 列表）」）；
 * 房间概览这一格只需要模式名，括号里那截属于噪音。
 */
function stripParenthetical(label: string): string {
  return label.replace(/（[^）]*）/g, '').trim() || label
}

const networkModeLabel = computed(() => {
  const label = props.connectInfo?.networkModeLabel?.trim()
  if (label) {
    return stripParenthetical(label)
  }
  const mode = props.cluster?.networkMode
  if (mode === 'public') {
    return '公网'
  }
  if (mode === 'lan_only') {
    return '仅局域网'
  }
  if (mode === 'offline') {
    return '离线'
  }
  return '—'
})

const playerCountText = computed(() => {
  const online = props.onlinePlayers
  if (!online || !online.running || online.onlinePlayerCount === null) {
    return '—'
  }
  return `${online.onlinePlayerCount} / ${online.maxPlayers}`
})

/**
 * Mod 概览只认「已生效」：文件就绪且开关打开才会被房间加载。
 * 只数开关会漏掉没下载下来的 Mod（导入存档后尤其常见），
 * 于是面板显示满员、游戏里却只加载出有文件的那几个。
 */
const notReadyModCount = computed(() => props.modList?.mods.filter(mod => mod.installStatus !== 'ready').length ?? 0)

const modCountText = computed(() => {
  const mods = props.modList?.mods
  if (!mods) {
    return '—'
  }
  const effective = mods.filter(mod => mod.enabled && mod.installStatus === 'ready').length
  return `${effective} / ${mods.length}`
})

const cavesText = computed(() => {
  const enabled = props.cluster?.shardEnabled
  if (typeof enabled !== 'boolean') {
    return '—'
  }
  return enabled ? '已开启' : '未开启'
})

function goConsole() {
  if (props.instance) {
    router.push(routeToInstanceConsole(props.instance.id))
  }
}

/** 房间玩家页按实例打开：在线玩家、踢人封禁与三份名单都在那里 */
function goPlayerManage() {
  if (props.instance) {
    router.push(routeToDstPlayerManage(props.instance.id))
  }
}

function goRoomSettings() {
  if (props.instance) {
    router.push(routeToDstRoomSettings(props.instance.id))
  }
}

function goWorldSettings() {
  if (props.instance) {
    router.push(routeToDstWorldSettings(props.instance.id))
  }
}

function goMods() {
  router.push(routeToDstModList())
}
</script>

<template>
  <NCard title="房间概览" size="small">
    <NSpin v-if="loading && !instance" class="block mx-auto my-6" />
    <template v-else-if="instance">
      <div
        v-if="isDst && installed"
        class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 lg:grid-cols-6"
      >
        <NStatistic label="房间名" :value="roomName" />
        <NStatistic label="游戏模式">
          {{ dstGameModeLabel(cluster?.gameMode) }}
        </NStatistic>
        <NStatistic label="联网模式">
          {{ networkModeLabel }}
        </NStatistic>
        <NStatistic label="在线玩家">
          <span :class="onlinePlayers?.running ? '' : 'text-muted-foreground'">
            {{ playerCountText }}
          </span>
        </NStatistic>
        <NStatistic label="Mod（已生效 / 总数）">
          {{ modCountText }}
          <NTag
            v-if="notReadyModCount > 0"
            size="tiny"
            :bordered="false"
            type="warning"
            class="ml-1"
          >
            {{ notReadyModCount }} 个未就绪
          </NTag>
        </NStatistic>
        <NStatistic label="洞穴">
          <NTag size="small" :bordered="false" :type="cavesText === '已开启' ? 'success' : 'default'">
            {{ cavesText }}
          </NTag>
        </NStatistic>
      </div>
      <NEmpty
        v-else-if="isDst"
        description="实例尚未完成安装，安装完成后可在此查看房间信息"
        size="small"
      />
      <NEmpty
        v-else
        description="当前游戏暂不支持房间配置，仅饥荒（DST）实例提供房间概览"
        size="small"
      />
      <!-- 快捷入口对已安装实例统一展示：非 DST 游戏没有房间/世界设置，但控制台照样要进得去 -->
      <div v-if="installed" class="mt-4 flex flex-wrap gap-2">
        <NButton size="small" secondary @click="goConsole">
          控制台
        </NButton>
        <NButton v-if="isDst" size="small" secondary @click="goPlayerManage">
          玩家管理
        </NButton>
        <template v-if="isDst">
          <NButton size="small" secondary @click="goRoomSettings">
            房间设置
          </NButton>
          <NButton size="small" secondary @click="goWorldSettings">
            世界设置
          </NButton>
          <NButton size="small" secondary @click="goMods">
            Mod 管理
          </NButton>
        </template>
      </div>
    </template>
    <NEmpty v-else description="未找到实例" size="small" />
  </NCard>
</template>
