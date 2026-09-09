<script setup lang="ts">
import type { InstanceItem } from '@/api/modules/instance'
import type { ClusterConfigDto, ClusterOnlinePlayersDto } from '@/api/modules/cluster'
import type { ModListDto } from '@/api/modules/mod'
import type { InstanceConnectInfo } from '@/api/modules/instance'
import { NButton, NCard, NEmpty, NSpin, NStatistic, NTag } from 'naive-ui'
import { computed } from 'vue'
import { routeToDstModList, routeToDstRoomSettings, routeToDstWorldSettings } from '@/navigation/game-routes'
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

const networkModeLabel = computed(() => {
  if (props.connectInfo?.networkModeLabel) {
    return props.connectInfo.networkModeLabel
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

const modCountText = computed(() => {
  const mods = props.modList?.mods
  if (!mods) {
    return '—'
  }
  const enabled = mods.filter(mod => mod.enabled).length
  return `${enabled} / ${mods.length}`
})

const cavesText = computed(() => {
  const enabled = props.cluster?.shardEnabled
  if (typeof enabled !== 'boolean') {
    return '—'
  }
  return enabled ? '已开启' : '未开启'
})

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
    <template v-else-if="instance && isDst && installed">
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 lg:grid-cols-6">
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
        <NStatistic label="Mod（启用 / 总数）">
          {{ modCountText }}
        </NStatistic>
        <NStatistic label="洞穴">
          <NTag size="small" :bordered="false" :type="cavesText === '已开启' ? 'success' : 'default'">
            {{ cavesText }}
          </NTag>
        </NStatistic>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <NButton size="small" secondary @click="goRoomSettings">
          房间设置
        </NButton>
        <NButton size="small" secondary @click="goWorldSettings">
          世界设置
        </NButton>
        <NButton size="small" secondary @click="goMods">
          Mod 管理
        </NButton>
      </div>
    </template>
    <template v-else-if="instance && isDst">
      <NEmpty description="实例尚未完成安装，安装完成后可在此查看房间信息" size="small" class="py-6" />
    </template>
    <template v-else-if="instance">
      <NEmpty description="当前游戏暂不支持房间配置，仅饥荒（DST）实例提供房间概览" size="small" class="py-6" />
    </template>
    <NEmpty v-else description="未找到实例" size="small" class="py-6" />
  </NCard>
</template>
