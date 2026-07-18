<script setup lang="ts">
import type { NodeListItem } from '@/api/modules/node'
import { NButton, NStatistic, NTag } from 'naive-ui'
import { onMounted, ref } from 'vue'
import AdminPageFeedback from '@/components/AdminPageFeedback.vue'
import apiNode from '@/api/modules/node'
import { useAdminPageState } from '@/composables/useAdminPageState'
import { formatDateTime, formatPercent } from '../utils'

defineOptions({
  name: 'NodeInstanceNodeOverview',
})

const emit = defineEmits<{
  nodesChange: [nodes: NodeListItem[]]
}>()

const registerLoading = ref(false)
const nodes = ref<NodeListItem[]>([])

const {
  loading,
  error,
  showPageSkeleton,
  showEmpty,
  showError,
  runLoad,
} = useAdminPageState(nodes)

async function fetchNodes() {
  await runLoad(async () => {
    const res = await apiNode.getNodeList()
    nodes.value = res.data
    emit('nodesChange', nodes.value)
  })
}

async function registerLocalNode() {
  registerLoading.value = true
  try {
    await apiNode.registerLocalNode()
    faToast.success('本地节点已重新注册')
    await fetchNodes()
  }
  finally {
    registerLoading.value = false
  }
}

onMounted(() => {
  void fetchNodes()
})
</script>

<template>
  <FaPageMain title="节点资源概览">
    <p class="mb-4 text-sm text-muted-foreground">
      查看各节点 CPU、内存与磁盘占用。节点离线时请先重注册本地节点。
    </p>
    <section class="p-4 border border-border rounded-xl bg-card space-y-4">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div class="flex gap-2">
          <NButton :loading="loading" @click="fetchNodes">
            刷新节点
          </NButton>
          <NButton type="error" strong secondary :loading="registerLoading" @click="registerLocalNode">
            重注册本地节点
          </NButton>
        </div>
      </div>

      <AdminPageFeedback
        :show-skeleton="showPageSkeleton"
        :show-error="showError"
        :error-message="error"
        :show-empty="showEmpty"
        empty-description="暂无可用节点"
        empty-action-label="重注册本地节点"
        @retry="fetchNodes"
        @empty-action="registerLocalNode"
      >
        <div class="gap-3 grid md:grid-cols-2 xl:grid-cols-3">
          <article
            v-for="node in nodes"
            :key="node.id"
            class="p-4 border border-border/80 rounded-lg bg-background"
          >
            <div class="flex gap-2 items-start justify-between">
              <div>
                <p class="text-sm font-semibold">
                  {{ node.name }}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
                  {{ node.host }}:{{ node.sshPort }}
                </p>
              </div>
              <NTag
                size="small"
                :bordered="false"
                :type="node.status === 'online' ? 'success' : 'error'"
              >
                {{ node.status === 'online' ? '在线' : '离线' }}
              </NTag>
            </div>
            <div class="text-xs mt-3 gap-2 grid grid-cols-3">
              <div class="p-2 rounded-md bg-muted/50">
                <NStatistic label="CPU" tabular-nums>
                  <template #default>
                    <span class="text-sm font-semibold">{{ formatPercent(node.resources.cpu.usageRate) }}</span>
                  </template>
                </NStatistic>
              </div>
              <div class="p-2 rounded-md bg-muted/50">
                <NStatistic label="内存" tabular-nums>
                  <template #default>
                    <span class="text-sm font-semibold">{{ formatPercent(node.resources.memory.usageRate) }}</span>
                  </template>
                </NStatistic>
              </div>
              <div class="p-2 rounded-md bg-muted/50">
                <NStatistic label="磁盘" tabular-nums>
                  <template #default>
                    <span class="text-sm font-semibold">{{ formatPercent(node.resources.disk.usageRate) }}</span>
                  </template>
                </NStatistic>
              </div>
            </div>
            <p class="text-xs text-muted-foreground mt-3">
              最近心跳：{{ formatDateTime(node.lastHeartbeatAt) }}
            </p>
          </article>
        </div>
      </AdminPageFeedback>
    </section>
  </FaPageMain>
</template>
