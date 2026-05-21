<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ShardContainerStatus, ShardListDto } from '@/api/modules/shard'
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NDataTable, NEmpty, NSpin, NTag } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import apiShard from '@/api/modules/shard'
import apiInstance from '@/api/modules/instance'
import { getStatusBadgeClass, getStatusLabel } from '@/views/node/instance/instanceDisplay'

defineOptions({
  name: 'ShardList',
})

const DST_APP_ID = '343050'

interface ShardListRow {
  instance: InstanceItem
  shardList: ShardListDto | null
  loadError: string | null
}

const router = useRouter()
const loading = ref(false)
const rows = ref<ShardListRow[]>([])

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

const hasRows = computed(() => rows.value.length > 0)

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
        return row.loadError ?? '—'
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
      const master = row.shardList?.shards.find(s => s.id === 'master')
      if (!master) {
        return '—'
      }
      return renderShardStatusTag(master.containerStatus)
    },
  },
  {
    title: '洞穴',
    key: 'caves',
    render: (row) => {
      const list = row.shardList
      if (!list) {
        return row.loadError ?? '—'
      }
      if (!list.clusterShardEnabled) {
        return h(NTag, { size: 'small', bordered: false, type: 'default' }, { default: () => '未开启' })
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
  router.push({
    name: 'shardSettings',
    params: { instanceId },
  })
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
  loading.value = true
  try {
    const response = await apiInstance.getInstanceList()
    const instances = (response.data ?? []) as InstanceItem[]
    const dstInstances = instances.filter(item =>
      item.gameCode === DST_APP_ID && item.status !== 'pending_install',
    )
    rows.value = await Promise.all(dstInstances.map(loadShardSummary))
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
          世界列表
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          查看地上与洞穴的运行状态。在房间设置中开启洞穴并保存后，可在此调整端口、地图与世界规则。
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
        :scroll-x="860"
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
