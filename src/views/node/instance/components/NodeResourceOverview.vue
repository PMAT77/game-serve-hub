<script setup lang="ts">
import type { NodeListItem } from '@/api/modules/node'
import { onMounted, ref } from 'vue'
import apiNode from '@/api/modules/node'
import { formatDateTime, formatPercent } from '../utils'

defineOptions({
  name: 'NodeInstanceNodeOverview',
})

const emit = defineEmits<{
  nodesChange: [nodes: NodeListItem[]]
}>()

const nodeLoading = ref(false)
const registerLoading = ref(false)
const nodes = ref<NodeListItem[]>([])

async function fetchNodes() {
  nodeLoading.value = true
  try {
    const res = await apiNode.getNodeList()
    nodes.value = res.data
    emit('nodesChange', nodes.value)
  }
  finally {
    nodeLoading.value = false
  }
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
    <section class="p-4 border border-border rounded-xl bg-card space-y-4">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <p class="text-sm text-muted-foreground">
            节点用于承载实例部署，实例主链路为：创建实例 -> SteamCMD 安装游戏 -> 生成启动脚本 -> 启停管理
          </p>
        </div>
        <div class="flex gap-2">
          <NButton :loading="nodeLoading" @click="fetchNodes">
            刷新节点
          </NButton>
          <NButton type="error" strong secondary :loading="registerLoading" @click="registerLocalNode">
            重注册本地节点
          </NButton>
        </div>
      </div>

      <div class="min-h-46">
        <div v-if="nodeLoading && !nodes.length" class="node-state-placeholder">
          节点数据加载中...
        </div>
        <div v-else-if="!nodes.length" class="node-state-placeholder">
          暂无可用节点，请先完成本地节点注册。
        </div>
        <div v-else class="gap-3 grid md:grid-cols-2 xl:grid-cols-3">
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
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="node.status === 'online'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'"
              >
                {{ node.status === 'online' ? '在线' : '离线' }}
              </span>
            </div>
            <div class="text-xs mt-3 gap-2 grid grid-cols-3">
              <div class="p-2 rounded-md bg-muted/50">
                <p class="text-muted-foreground">
                  CPU
                </p>
                <p class="font-semibold mt-1">
                  {{ formatPercent(node.resources.cpu.usageRate) }}
                </p>
              </div>
              <div class="p-2 rounded-md bg-muted/50">
                <p class="text-muted-foreground">
                  内存
                </p>
                <p class="font-semibold mt-1">
                  {{ formatPercent(node.resources.memory.usageRate) }}
                </p>
              </div>
              <div class="p-2 rounded-md bg-muted/50">
                <p class="text-muted-foreground">
                  磁盘
                </p>
                <p class="font-semibold mt-1">
                  {{ formatPercent(node.resources.disk.usageRate) }}
                </p>
              </div>
            </div>
            <p class="text-xs text-muted-foreground mt-3">
              最近心跳：{{ formatDateTime(node.lastHeartbeatAt) }}
            </p>
          </article>
        </div>
      </div>
    </section>
  </FaPageMain>
</template>

<style scoped>
.node-state-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 10rem;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
  text-align: center;
}
</style>
