<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ShardContainerStatus } from '@/api/modules/shard'
import type { DstInstanceSummaryDto } from '@/api/modules/dst-summary'
import { NButton, NDataTable, NTag, NTooltip } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import AdminListToolbar from '@/components/AdminListToolbar.vue'
import AdminPageFeedback from '@/components/AdminPageFeedback.vue'
import apiDstSummary from '@/api/modules/dst-summary'
import { useAdminPageState } from '@/composables/useAdminPageState'
import { routeToDstWorldSettings, routeToNodeInstance } from '@/navigation/game-routes'
import { getStatusBadgeClass, getStatusLabel } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'DstWorldList',
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

const containerStatusLabel: Record<ShardContainerStatus, string> = {
  running: '运行中',
  stopped: '已停止',
  not_created: '未创建',
  unknown: '未知',
}

function renderShardStatusTag(status: ShardContainerStatus) {
  const type = status === 'running' ? 'success' : status === 'stopped' ? 'warning' : 'default'
  return h(
    NTag,
    { size: 'small', bordered: false, type },
    { default: () => containerStatusLabel[status] },
  )
}

function shardStatusText(row: DstInstanceSummaryDto, shardId: 'master' | 'caves'): string {
  const shard = row.world[shardId]
  if (!shard) {
    return '—'
  }
  if (!shard.configured) {
    return '待配置'
  }
  return containerStatusLabel[shard.containerStatus]
}

const filteredRows = computed(() => {
  const keyword = keywordFilter.value.trim().toLowerCase()
  if (!keyword) {
    return rows.value
  }
  return rows.value.filter(row =>
    row.instance.name.toLowerCase().includes(keyword),
  )
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
    title: '洞穴',
    key: 'clusterShard',
    render: (row) => {
      const enabled = row.world.clusterShardEnabled
      if (enabled === null) {
        if (row.world.error) {
          return h(
            NTooltip,
            { trigger: 'hover' },
            {
              trigger: () => h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '异常' }),
              default: () => row.world.error,
            },
          )
        }
        return '—'
      }
      return h(
        NTag,
        { size: 'small', bordered: false, type: enabled ? 'info' : 'default' },
        { default: () => (enabled ? '已开启' : '未开启') },
      )
    },
  },
  {
    title: '主世界',
    key: 'master',
    render: (row) => {
      const master = row.world.master
      if (!master) {
        return '—'
      }
      if (!master.configured) {
        return h(NTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '待修复' })
      }
      return renderShardStatusTag(master.containerStatus)
    },
  },
  {
    title: '洞穴分片',
    key: 'caves',
    render: (row) => {
      const caves = row.world.caves
      if (!caves) {
        return '—'
      }
      if (!caves.configured) {
        return h(NTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '待修复' })
      }
      return renderShardStatusTag(caves.containerStatus)
    },
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
      { default: () => '配置世界' },
    ),
  },
]

function openSettings(instanceId: string) {
  router.push(routeToDstWorldSettings(instanceId))
}

function goToInstanceManagement() {
  router.push(routeToNodeInstance())
}

async function loadRows() {
  await runLoad(async () => {
    const response = await apiDstSummary.getDstInstanceSummaries()
    rows.value = response.data.items
  })
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
        世界列表
      </h1>
      <p class="mt-1 text-sm text-muted-foreground">
        查看地上与洞穴分片状态。洞穴开启后在此调整端口、地图与世界规则。
      </p>
    </div>

    <AdminListToolbar
      v-model:keyword="keywordFilter"
      keyword-placeholder="实例名称"
      :search-loading="loading"
      :reset-disabled="!keywordFilter"
      @search="() => {}"
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
          :scroll-x="860"
        />
        <div v-else class="space-y-3" :aria-busy="showTableLoading">
          <article
            v-for="row in filteredRows"
            :key="row.instance.id"
            class="rounded-lg border border-border bg-card p-4 space-y-3"
          >
            <div class="flex items-start justify-between gap-3">
              <h2 class="min-w-0 truncate font-medium">
                {{ row.instance.name }}
              </h2>
              <NTag size="small" :bordered="false" :class="getStatusBadgeClass(row.instance.status)">
                {{ getStatusLabel(row.instance.status) }}
              </NTag>
            </div>
            <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <div>
                <dt class="text-muted-foreground">洞穴</dt>
                <dd>{{ row.world.clusterShardEnabled === null ? '—' : row.world.clusterShardEnabled ? '已启用' : '未启用' }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">地上世界</dt>
                <dd>{{ shardStatusText(row, 'master') }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">洞穴分片</dt>
                <dd>{{ shardStatusText(row, 'caves') }}</dd>
              </div>
              <div v-if="row.world.error" class="col-span-2 text-amber-600 dark:text-amber-400">
                {{ row.world.error }}
              </div>
            </dl>
            <NButton block :disabled="row.instance.status === 'pending_install'" @click="openSettings(row.instance.id)">
              配置世界
            </NButton>
          </article>
        </div>
      </template>
      <div
        v-else-if="showFilteredEmpty"
        class="text-muted-foreground py-12 text-center text-sm"
      >
        没有匹配「{{ keywordFilter }}」的世界，请调整关键词或重置筛选。
      </div>
    </AdminPageFeedback>
  </FaPageMain>
</template>
