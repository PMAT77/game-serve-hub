<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ShardContainerStatus, ShardListDto } from '@/api/modules/shard'
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NDataTable, NTag, NTooltip } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import AdminListToolbar from '@/components/AdminListToolbar.vue'
import AdminPageFeedback from '@/components/AdminPageFeedback.vue'
import apiShard from '@/api/modules/shard'
import apiInstance from '@/api/modules/instance'
import { useAdminPageState } from '@/composables/useAdminPageState'
import { isInstallableGameInstance } from '@/composables/useGameInstance'
import { routeToDstWorldSettings, routeToNodeInstance } from '@/navigation/game-routes'
import { getStatusBadgeClass, getStatusLabel } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'DstWorldList',
})

interface ShardListRow {
  instance: InstanceItem
  shardList: ShardListDto | null
  loadError: string | null
}

const router = useRouter()
const rows = ref<ShardListRow[]>([])
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

const columns: DataTableColumns<ShardListRow> = [
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
      const enabled = row.shardList?.clusterShardEnabled
      if (enabled === undefined) {
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
      const list = row.shardList
      if (!list) {
        return '—'
      }
      const master = list.shards.find(s => s.id === 'master')
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
      const list = row.shardList
      if (!list) {
        return '—'
      }
      const caves = list.shards.find(s => s.id === 'caves')
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

async function loadShardSummary(instance: InstanceItem): Promise<ShardListRow> {
  if (instance.status === 'pending_install' || !instance.installPath) {
    return {
      instance,
      shardList: null,
      loadError: instance.status === 'pending_install' ? '尚未安装' : null,
    }
  }
  try {
    const response = await apiShard.getShardList(instance.id)
    return {
      instance,
      shardList: response.data,
      loadError: null,
    }
  }
  catch {
    return {
      instance,
      shardList: null,
      loadError: '读取失败',
    }
  }
}

async function loadRows() {
  await runLoad(async () => {
    const response = await apiInstance.getInstanceList()
    const instances = (response.data ?? []) as InstanceItem[]
    const dstInstances = instances.filter(isInstallableGameInstance)
    rows.value = await Promise.all(dstInstances.map(loadShardSummary))
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
      <NDataTable
        v-if="hasFilteredRows"
        :bordered="false"
        :single-line="false"
        :columns="columns"
        :data="filteredRows"
        :loading="showTableLoading"
        :scroll-x="860"
      />
      <div
        v-else-if="showFilteredEmpty"
        class="text-muted-foreground py-12 text-center text-sm"
      >
        没有匹配「{{ keywordFilter }}」的世界，请调整关键词或重置筛选。
      </div>
    </AdminPageFeedback>
  </FaPageMain>
</template>
