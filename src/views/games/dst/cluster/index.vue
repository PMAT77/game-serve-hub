<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ClusterNetworkMode } from '@/api/modules/cluster'
import type { DstInstanceSummaryDto } from '@/api/modules/dst-summary'
import { NButton, NDataTable, NTag, NTooltip } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import AdminListToolbar from '@/components/AdminListToolbar.vue'
import AdminPageFeedback from '@/components/AdminPageFeedback.vue'
import apiDstSummary from '@/api/modules/dst-summary'
import { useAdminPageState } from '@/composables/useAdminPageState'
import { routeToDstRoomSettings, routeToNodeInstance } from '@/navigation/game-routes'
import { getStatusBadgeClass, getStatusLabel } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'DstRoomList',
})

const router = useRouter()
const appSettingsStore = useAppSettingsStore()
const rows = ref<DstInstanceSummaryDto[]>([])
const keywordFilter = ref('')
const isMobileMode = computed(() => appSettingsStore.mode === 'mobile')

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
      row.room.clusterName ?? '',
      row.instance.gameCode ?? '',
    ].join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

const hasFilteredRows = computed(() => filteredRows.value.length > 0)
const showFilteredEmpty = computed(() => initialLoadDone.value && !loading.value && rows.value.length > 0 && !hasFilteredRows.value)

const columns: DataTableColumns<DstInstanceSummaryDto> = [
  {
    title: '实例名称',
    key: 'instanceName',
    render: row => row.instance.name,
  },
  {
    title: '房间名称',
    key: 'clusterName',
    render: row => row.room.clusterName ?? '—',
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
      if (row.room.networkMode) {
        return networkModeLabel[row.room.networkMode]
      }
      if (row.room.error) {
        return h(
          NTooltip,
          { trigger: 'hover' },
          {
            trigger: () => h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '异常' }),
            default: () => row.room.error,
          },
        )
      }
      return '—'
    },
  },
  {
    title: '洞穴',
    key: 'caves',
    render: row => buildCavesSummary(row.room.shardEnabled, row.world.caves?.configured),
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

function buildCavesSummary(shardEnabled: boolean | null, cavesConfigured: boolean | undefined): string {
  if (shardEnabled === null) {
    return '—'
  }
  if (!shardEnabled) {
    return cavesConfigured ? '未启用' : '未开启'
  }
  return cavesConfigured ? '已开启' : '待修复'
}

function formatOnlinePlayers(row: DstInstanceSummaryDto): string {
  if (row.instance.status !== 'running') {
    return '—'
  }
  if (row.room.onlinePlayerCount === null || row.room.maxPlayers === null) {
    return '—'
  }
  return `${row.room.onlinePlayerCount} / ${row.room.maxPlayers}`
}

async function loadRows() {
  await runLoad(async () => {
    const response = await apiDstSummary.getDstInstanceSummaries()
    rows.value = response.data.items
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
      <template v-if="hasFilteredRows">
        <NDataTable
          v-if="!isMobileMode"
          :bordered="false"
          :single-line="false"
          :columns="columns"
          :data="filteredRows"
          :loading="showTableLoading"
          :scroll-x="1000"
        />
        <div v-else class="space-y-3" :aria-busy="showTableLoading">
          <article
            v-for="row in filteredRows"
            :key="row.instance.id"
            class="rounded-lg border border-border bg-card p-4 space-y-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate font-medium">
                  {{ row.instance.name }}
                </h2>
                <p class="mt-1 text-sm text-muted-foreground truncate">
                  {{ row.room.clusterName || '尚未配置房间名称' }}
                </p>
              </div>
              <NTag size="small" :bordered="false" :class="getStatusBadgeClass(row.instance.status)">
                {{ getStatusLabel(row.instance.status) }}
              </NTag>
            </div>
            <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt class="text-muted-foreground">联机模式</dt>
                <dd>{{ row.room.networkMode ? networkModeLabel[row.room.networkMode] : '—' }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">在线人数</dt>
                <dd>{{ formatOnlinePlayers(row) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">洞穴</dt>
                <dd>{{ buildCavesSummary(row.room.shardEnabled, row.world.caves?.configured) }}</dd>
              </div>
              <div v-if="row.room.error" class="col-span-2 text-amber-600 dark:text-amber-400">
                {{ row.room.error }}
              </div>
            </dl>
            <NButton block :disabled="row.instance.status === 'pending_install'" @click="openSettings(row.instance.id)">
              配置房间
            </NButton>
          </article>
        </div>
      </template>
      <div
        v-else-if="showFilteredEmpty"
        class="text-muted-foreground py-12 text-center text-sm"
      >
        没有匹配「{{ keywordFilter }}」的房间，请调整关键词或重置筛选。
      </div>
    </AdminPageFeedback>
  </FaPageMain>
</template>
