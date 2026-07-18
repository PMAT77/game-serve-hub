<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ClusterNetworkMode } from '@/api/modules/cluster'
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NDataTable, NTag, NTooltip } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import AdminListToolbar from '@/components/AdminListToolbar.vue'
import AdminPageFeedback from '@/components/AdminPageFeedback.vue'
import apiCluster from '@/api/modules/cluster'
import apiShard from '@/api/modules/shard'
import apiInstance from '@/api/modules/instance'
import { useAdminPageState } from '@/composables/useAdminPageState'
import { isInstallableGameInstance } from '@/composables/useGameInstance'
import { routeToDstRoomSettings, routeToNodeInstance } from '@/navigation/game-routes'
import { getStatusBadgeClass, getStatusLabel } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'DstRoomList',
})

interface ClusterListRow {
  instance: InstanceItem
  networkMode: ClusterNetworkMode | null
  clusterName: string | null
  shardEnabled: boolean | null
  cavesSummary: string | null
  onlinePlayerCount: number | null
  maxPlayers: number | null
  loadError: string | null
}

const router = useRouter()
const rows = ref<ClusterListRow[]>([])
const keywordFilter = ref('')

const {
  loading,
  error,
  showPageSkeleton,
  showTableLoading,
  showEmpty,
  showError,
  initialLoadDone,
  runLoad,
} = useAdminPageState(rows)

const networkModeLabel: Record<ClusterNetworkMode, string> = {
  offline: '离线',
  lan_only: '仅局域网',
  public: '公网',
}

const filteredRows = computed(() => {
  const keyword = keywordFilter.value.trim().toLowerCase()
  if (!keyword) {
    return rows.value
  }
  return rows.value.filter((row) => {
    const haystack = [
      row.instance.name,
      row.clusterName ?? '',
      row.instance.gameCode ?? '',
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

const hasFilteredRows = computed(() => filteredRows.value.length > 0)
const showFilteredEmpty = computed(() => initialLoadDone.value && !loading.value && rows.value.length > 0 && !hasFilteredRows.value)

const columns: DataTableColumns<ClusterListRow> = [
  {
    title: '实例名称',
    key: 'instanceName',
    render: row => row.instance.name,
  },
  {
    title: '房间名称',
    key: 'clusterName',
    render: row => row.clusterName ?? '—',
  },
  {
    title: '运行状态',
    key: 'status',
    render: (row) => {
      const status = row.instance.status
      return h(
        NTag,
        { size: 'small', bordered: false, class: getStatusBadgeClass(status) },
        { default: () => getStatusLabel(status) },
      )
    },
  },
  {
    title: '在线人数',
    key: 'onlinePlayers',
    width: 100,
    align: 'right',
    render: row => formatOnlinePlayers(row),
  },
  {
    title: '联网模式',
    key: 'networkMode',
    render: (row) => {
      if (row.networkMode) {
        return networkModeLabel[row.networkMode]
      }
      if (row.loadError) {
        return h(
          NTooltip,
          { trigger: 'hover' },
          {
            trigger: () => h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '异常' }),
            default: () => row.loadError,
          },
        )
      }
      return '—'
    },
  },
  {
    title: '洞穴',
    key: 'caves',
    render: row => row.cavesSummary ?? '—',
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    fixed: 'right',
    render: row => h(
      NButton,
      {
        size: 'small',
        type: 'info',
        text: true,
        disabled: row.instance.status === 'pending_install',
        onClick: () => openSettings(row.instance.id),
      },
      { default: () => '配置房间' },
    ),
  },
]

function openSettings(instanceId: string) {
  router.push(routeToDstRoomSettings(instanceId))
}

function goToInstanceManagement() {
  router.push(routeToNodeInstance())
}

function buildCavesSummary(shardEnabled: boolean, cavesConfigured: boolean): string {
  if (!shardEnabled) {
    return cavesConfigured ? '未启用' : '未开启'
  }
  return cavesConfigured ? '已开启' : '待修复'
}

function formatOnlinePlayers(row: ClusterListRow): string {
  if (row.instance.status !== 'running') {
    return '—'
  }
  if (row.onlinePlayerCount === null || row.maxPlayers === null) {
    return '—'
  }
  return `${row.onlinePlayerCount} / ${row.maxPlayers}`
}

async function loadOnlinePlayers(instance: InstanceItem): Promise<Pick<ClusterListRow, 'onlinePlayerCount' | 'maxPlayers'>> {
  if (instance.status !== 'running') {
    return { onlinePlayerCount: null, maxPlayers: null }
  }
  try {
    const response = await apiCluster.getOnlinePlayers(instance.id)
    const data = response.data
    return {
      onlinePlayerCount: data.onlinePlayerCount,
      maxPlayers: data.maxPlayers,
    }
  }
  catch {
    return { onlinePlayerCount: null, maxPlayers: null }
  }
}

async function loadClusterSummary(instance: InstanceItem): Promise<ClusterListRow> {
  if (instance.status === 'pending_install' || !instance.installPath) {
    return {
      instance,
      networkMode: null,
      clusterName: null,
      shardEnabled: null,
      cavesSummary: null,
      onlinePlayerCount: null,
      maxPlayers: null,
      loadError: instance.status === 'pending_install' ? '尚未安装' : null,
    }
  }
  try {
    const [clusterRes, shardRes, onlineRes] = await Promise.all([
      apiCluster.getClusterConfig(instance.id),
      apiShard.getShardList(instance.id),
      loadOnlinePlayers(instance),
    ])
    const config = clusterRes.data
    const caves = shardRes.data.shards.find(s => s.id === 'caves')
    const cavesConfigured = Boolean(caves?.configured)
    return {
      instance,
      networkMode: config.networkMode,
      clusterName: config.clusterName,
      shardEnabled: config.shardEnabled,
      cavesSummary: buildCavesSummary(config.shardEnabled, cavesConfigured),
      onlinePlayerCount: onlineRes.onlinePlayerCount,
      maxPlayers: onlineRes.maxPlayers ?? config.maxPlayers,
      loadError: null,
    }
  }
  catch {
    return {
      instance,
      networkMode: null,
      clusterName: null,
      shardEnabled: null,
      cavesSummary: null,
      onlinePlayerCount: null,
      maxPlayers: null,
      loadError: '读取失败',
    }
  }
}

async function loadRows() {
  await runLoad(async () => {
    const response = await apiInstance.getInstanceList()
    const instances = (response.data ?? []) as InstanceItem[]
    const dstInstances = instances.filter(isInstallableGameInstance)
    rows.value = await Promise.all(dstInstances.map(loadClusterSummary))
  })
}

function searchRows() {
  // 客户端筛选，keyword 已绑定 filteredRows
}

function resetFilters() {
  keywordFilter.value = ''
}

onMounted(() => {
  void loadRows()
})
</script>

<template>
  <FaPageMain main-class="flex flex-col gap-4">
    <div>
      <h1 class="text-lg font-semibold">
        房间列表
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        汇总各 DST 实例的房间配置。安装完成后在此进入联网与房间设置。
      </p>
    </div>

    <AdminListToolbar
      v-model:keyword="keywordFilter"
      keyword-placeholder="实例名称 / 房间名称"
      :search-loading="loading"
      :reset-disabled="!keywordFilter"
      @search="searchRows"
      @reset="resetFilters"
    >
      <template #actions>
        <NButton :loading="loading" @click="loadRows">
          刷新
        </NButton>
      </template>
    </AdminListToolbar>

    <AdminPageFeedback
      :show-skeleton="showPageSkeleton"
      :show-error="showError"
      :error-message="error"
      :show-empty="showEmpty"
      empty-description="暂无已安装的 DST 实例"
      empty-action-label="前往实例管理"
      @retry="loadRows"
      @empty-action="goToInstanceManagement"
    >
      <NDataTable
        v-if="hasFilteredRows"
        :bordered="false"
        :single-line="false"
        :columns="columns"
        :data="filteredRows"
        :loading="showTableLoading"
        :scroll-x="1000"
      />
      <div
        v-else-if="showFilteredEmpty"
        class="text-muted-foreground py-12 text-center text-sm"
      >
        没有匹配「{{ keywordFilter }}」的房间，请调整关键词或重置筛选。
      </div>
    </AdminPageFeedback>
  </FaPageMain>
</template>
