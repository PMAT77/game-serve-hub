<script setup lang="ts">
import type { InstanceConnectInfo, InstanceItem } from '@/api/modules/instance'
import type { ClusterConfigDto, ClusterOnlinePlayersDto } from '@/api/modules/cluster'
import type { ModListDto } from '@/api/modules/mod'
import type { ShardListDto } from '@/api/modules/shard'
import apiCluster from '@/api/modules/cluster'
import apiInstance from '@/api/modules/instance'
import apiMod from '@/api/modules/mod'
import apiShard from '@/api/modules/shard'
import { NButton, NSpin } from 'naive-ui'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { routeToDstPlayerManage, routeToInstanceConsole, routeToNodeInstance } from '@/navigation/game-routes'
import { statusBadgeClass } from '@/constants/statusDictionary'
import { getInstanceState } from './instanceDisplay'
import CommandCenterCard from './components/detail/CommandCenterCard.vue'
import InstanceFilesCard from './components/detail/InstanceFilesCard.vue'
import InstanceMigrationCard from './components/detail/InstanceMigrationCard.vue'
import InstanceControlCard from './components/detail/InstanceControlCard.vue'
import RoomOverviewCard from './components/detail/RoomOverviewCard.vue'
import WorldOverviewCard, { type InstanceWorldState } from './components/detail/WorldOverviewCard.vue'
import { instanceSupportsDstRoom } from '@/composables/useGameInstance'

defineOptions({
  name: 'NodeInstanceDetail',
})

const route = useRoute()
const router = useRouter()

const instanceId = computed(() => String(route.params.instanceId ?? ''))

const loading = ref(false)
const instance = ref<InstanceItem | null>(null)
const cluster = ref<ClusterConfigDto | null>(null)
const shardList = ref<ShardListDto | null>(null)
const onlinePlayers = ref<ClusterOnlinePlayersDto | null>(null)
const modList = ref<ModListDto | null>(null)
const connectInfo = ref<InstanceConnectInfo | null>(null)
const worldState = ref<InstanceWorldState | null>(null)

const pageTitle = computed(() => instance.value
  ? `实例详情 · ${instance.value.name}`
  : '实例详情')

const state = computed(() => (instance.value ? getInstanceState(instance.value) : null))

/** 运行中的实例每 30 秒静默刷新概览数据 */
const DETAIL_POLL_MS = 30_000
let pollTimer: ReturnType<typeof setInterval> | undefined

/**
 * 路由对本页开启了 keepAlive：离开详情页时组件不会卸载，定时器与 watch 都还活着。
 * 只有「本页正被激活」且「当前路由就是详情页」时才允许它自己导航，
 * 否则后台轮询会把停在别的页面上的用户强行拉回实例管理列表。
 */
let pageActive = true
const isDetailRouteActive = computed(() => route.name === 'nodeInstanceDetail')

function ownsCurrentPage() {
  return pageActive && isDetailRouteActive.value
}

async function loadDetail(options?: { silent?: boolean }) {
  if (!instanceId.value) {
    if (ownsCurrentPage()) {
      router.replace(routeToNodeInstance())
    }
    return
  }
  if (!options?.silent) {
    loading.value = true
  }
  try {
    const targetId = instanceId.value
    const listRes = await apiInstance.getInstanceList()
    if (targetId !== instanceId.value) {
      return
    }
    const target = (listRes.data as InstanceItem[]).find(item => item.id === targetId)
    if (!target) {
      // 被缓存在别的路由上时保持静默：返回详情页后 onActivated 会重新检测，
      // 那时再提示并跳回列表页
      if (ownsCurrentPage()) {
        faToast.warning('实例不存在或已删除')
        router.replace(routeToNodeInstance())
      }
      return
    }
    instance.value = target

    // 概览数据并行拉取，单项失败不阻塞页面（对应卡片展示空态）
    const [clusterRes, shardRes, onlineRes, modRes, connectRes] = await Promise.allSettled([
      apiCluster.getClusterConfig(targetId),
      apiShard.getShardList(targetId),
      apiCluster.getOnlinePlayers(targetId),
      apiMod.getModList(targetId),
      apiInstance.getInstanceConnectInfo(targetId),
    ])
    if (targetId !== instanceId.value) {
      return
    }
    cluster.value = clusterRes.status === 'fulfilled' ? clusterRes.value.data : null
    shardList.value = shardRes.status === 'fulfilled' ? shardRes.value.data : null
    onlinePlayers.value = onlineRes.status === 'fulfilled' ? onlineRes.value.data : null
    modList.value = modRes.status === 'fulfilled' ? modRes.value.data : null
    connectInfo.value = connectRes.status === 'fulfilled' ? connectRes.value.data : null

    // P1：运行中实例查询世界状态（天数/季节），失败静默
    worldState.value = null
    if (target.status === 'running') {
      try {
        const res = await apiInstance.getInstanceWorldState(targetId, 'master')
        worldState.value = res.data
      }
      catch {
        // 世界状态查询失败不阻塞详情页
      }
    }
  }
  catch {
    // 全局拦截器已提示错误原因
  }
  finally {
    if (!options?.silent) {
      loading.value = false
    }
  }
}

function goBack() {
  router.push(routeToNodeInstance())
}

function goConsole() {
  if (instance.value) {
    router.push(routeToInstanceConsole(instance.value.id))
  }
}

/** 房间玩家页按实例打开：在线玩家、踢人封禁与三份名单都在那里 */
function goPlayerManage() {
  if (instance.value) {
    router.push(routeToDstPlayerManage(instance.value.id))
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

function syncPolling() {
  stopPolling()
  if (!ownsCurrentPage()) {
    return
  }
  if (instance.value?.status === 'running') {
    pollTimer = setInterval(() => {
      void loadDetail({ silent: true })
    }, DETAIL_POLL_MS)
  }
}

watch(() => instance.value?.status, () => syncPolling())
watch(instanceId, () => {
  // 组件被 keepAlive 缓存：离开详情页后 watch 仍会对全局 route.params 生效，
  // 别的页面（控制台 / 世界设置 / 房间设置）同样带 :instanceId，参数一变就会
  // 触发这里的重载，进而可能把用户从那些页面顶回实例管理列表。
  // 因此只在「本页被激活且当前路由就是详情页」时才响应。
  if (!ownsCurrentPage()) {
    return
  }
  instance.value = null
  cluster.value = null
  shardList.value = null
  onlinePlayers.value = null
  modList.value = null
  connectInfo.value = null
  worldState.value = null
  void loadDetail()
})

onMounted(() => {
  pageActive = true
  void loadDetail()
})

onActivated(() => {
  pageActive = true
  void loadDetail({ silent: true })
  // 返回页面时实例状态往往没变化，watch(status) 不会触发，必须显式恢复轮询
  syncPolling()
})

onDeactivated(() => {
  pageActive = false
  stopPolling()
})

onBeforeUnmount(() => {
  pageActive = false
  stopPolling()
})
</script>

<template>
  <FaPageMain :title="pageTitle">
    <NSpin v-if="loading && !instance" class="block mx-auto my-10" />
    <div v-else class="space-y-4">
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <div class="flex flex-wrap items-center gap-2 min-w-0">
          <NButton size="small" quaternary @click="goBack">
            <template #icon>
              <FaIcon name="i-lucide:arrow-left" />
            </template>
            返回列表
          </NButton>
          <template v-if="instance && state">
            <span class="font-medium truncate">{{ instance.name }}</span>
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :class="statusBadgeClass(state.tone)"
            >
              {{ state.label }}
            </span>
          </template>
        </div>
        <div class="flex flex-wrap gap-2">
          <NButton
            v-if="instance && instance.status !== 'pending_install' && instance.status !== 'installing'"
            size="small"
            secondary
            @click="goConsole"
          >
            控制台
          </NButton>
          <NButton
            v-if="instance && instanceSupportsDstRoom(instance) && instance.status !== 'pending_install' && instance.status !== 'installing'"
            size="small"
            secondary
            @click="goPlayerManage"
          >
            玩家管理
          </NButton>
          <NButton size="small" secondary :loading="loading" @click="() => loadDetail()">
            <template #icon>
              <FaIcon name="i-lucide:refresh-cw" />
            </template>
            刷新
          </NButton>
        </div>
      </div>

      <RoomOverviewCard
        :instance="instance"
        :cluster="cluster"
        :online-players="onlinePlayers"
        :mod-list="modList"
        :connect-info="connectInfo"
        :loading="loading"
      />

      <div class="grid gap-4 lg:grid-cols-2">
        <InstanceControlCard
          :instance="instance"
          @refreshed="() => loadDetail({ silent: true })"
        />
        <WorldOverviewCard
          :instance="instance"
          :shard-list="shardList"
          :world-state="worldState"
          :loading="loading"
          @refreshed="() => loadDetail({ silent: true })"
        />
      </div>

      <CommandCenterCard
        :instance="instance"
        :connect-info="connectInfo"
        @refreshed="() => loadDetail({ silent: true })"
      />

      <InstanceFilesCard
        v-if="instance"
        :instance-id="instance.id"
      />

      <InstanceMigrationCard
        v-if="instance && instanceSupportsDstRoom(instance)"
        :instance-id="instance.id"
      />

      <p v-if="instance" class="text-xs text-muted-foreground">
        实例 ID：{{ instance.id }}
      </p>
    </div>
  </FaPageMain>
</template>
