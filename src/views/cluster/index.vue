<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ClusterNetworkMode } from '@/api/modules/cluster'
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NDataTable, NEmpty, NSpin, NTag } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import apiCluster from '@/api/modules/cluster'
import apiInstance from '@/api/modules/instance'
import { getStatusBadgeClass, getStatusLabel } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'ClusterList',
})

const DST_APP_ID = '343050'

interface ClusterListRow {
  instance: InstanceItem
  networkMode: ClusterNetworkMode | null
  clusterName: string | null
  loadError: string | null
}

const router = useRouter()
const loading = ref(false)
const rows = ref<ClusterListRow[]>([])

const networkModeLabel: Record<ClusterNetworkMode, string> = {
  offline: '离线',
  lan_only: '仅局域网',
  public: '公网（Klei 列表）',
}

const hasRows = computed(() => rows.value.length > 0)

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
    title: '联网模式',
    key: 'networkMode', 
    render: row => row.networkMode ? networkModeLabel[row.networkMode] : (row.loadError ?? '—'),
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
  router.push({
    name: 'clusterSettings',
    params: { instanceId },
  })
}

async function loadClusterSummary(instance: InstanceItem): Promise<ClusterListRow> {
  if (instance.status === 'pending_install' || !instance.installPath) {
    return {
      instance,
      networkMode: null,
      clusterName: null,
      loadError: instance.status === 'pending_install' ? '尚未安装' : null,
    }
  }
  try {
    const response = await apiCluster.getClusterConfig(instance.id)
    const config = response.data
    return {
      instance,
      networkMode: config.networkMode,
      clusterName: config.clusterName,
      loadError: null,
    }
  }
  catch {
    return {
      instance,
      networkMode: null,
      clusterName: null,
      loadError: '读取失败',
    }
  }
}

async function loadRows() {
  loading.value = true
  try {
    const response = await apiInstance.getInstanceList()
    const instances = (response.data ?? []) as InstanceItem[]
    const dstInstances = instances.filter(item =>
      item.gameCode === DST_APP_ID && item.status !== 'pending_install',
    )
    rows.value = await Promise.all(dstInstances.map(loadClusterSummary))
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadRows()
})
</script>

<template>
  <FaPageMain class="space-y-4">
    <div class="flex items-center justify-between gap-4 mb-4">
      <div>
        <h1 class="text-lg font-semibold">
          房间列表
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          每个 DST 实例对应一个房间（Cluster）。在此配置联网模式、房间名称与 Klei 令牌。
        </p>
      </div>
      <NButton :loading="loading" @click="loadRows">
        刷新
      </NButton>
    </div>

    <NSpin :show="loading">
      <NDataTable
        v-if="hasRows" 
        :bordered="false"
        :single-line="false"
        :columns="columns"
        :data="rows" 
        :scroll-x="760"
      />
      <NEmpty
        v-else-if="!loading"
        description="暂无已安装的 DST 实例"
      >
        <template #extra>
          <NButton type="primary" @click="router.push({ name: 'nodeInstance' })">
            前往实例管理
          </NButton>
        </template>
      </NEmpty>
    </NSpin>
  </FaPageMain>
</template>
