<script setup lang="ts">
import type { NodeListItem } from '@/api/modules/node'
import { onMounted, ref } from 'vue'
import apiNode from '@/api/modules/node'
import apiSystem from '@/api/modules/system'
import InstanceManagement from './components/InstanceManagement.vue'
import NodeResourceOverview from './components/NodeResourceOverview.vue'
import SteamcmdPanel from './components/SteamcmdPanel.vue'

defineOptions({
  name: 'NodeInstanceManagement',
})

const nodes = ref<NodeListItem[]>([])
const steamcmdInstalled = ref(false)

/**
 * 运行环境折叠面板固定默认折叠，不再跟随安装状态自动展开/收起。
 *
 * naive-ui 折叠面板在“从未展开过”时不渲染内容（CollapseItemContent 的 onceTrue
 * 机制，此时 display-directive="show" 也不生效），面板内组件因此不会挂载。
 * 而下方实例管理依赖 nodes 与安装状态，所以在页面级先取一次；面板内组件仍会
 * 通过事件上报，保证展开后手动刷新的结果能同步回来。
 */
const envExpandedNames = ref<string[]>([])

async function loadNodes() {
  try {
    const res = await apiNode.getNodeList()
    nodes.value = res.data
  }
  catch {
    // 首屏兜底失败时保持空列表，展开面板后可在面板内重试
  }
}

async function loadSteamcmdState() {
  try {
    const res = await apiSystem.getSteamcmdConfig()
    steamcmdInstalled.value = Boolean(res.data.isSteamcmdInstalled)
  }
  catch {
    // 首屏兜底失败时保持未就绪，展开面板后可在面板内重试
  }
}

onMounted(() => {
  void loadNodes()
  void loadSteamcmdState()
})

function onNodesChange(list: NodeListItem[]) {
  nodes.value = list
}

function onSteamcmdStateChange(payload: { installed: boolean }) {
  steamcmdInstalled.value = payload.installed
}
</script>

<template>
  <div class="space-y-4">
    <FaPageMain>
      <NCollapse v-model:expanded-names="envExpandedNames" display-directive="show">
        <NCollapseItem name="env">
          <template #header>
            <span class="font-medium">运行环境</span>
            <NTag
              size="small"
              :bordered="false"
              :type="steamcmdInstalled ? 'success' : 'warning'"
              class="ml-2"
            >
              {{ steamcmdInstalled ? '就绪' : '需要初始化' }}
            </NTag>
          </template>
          <div class="space-y-4">
            <NodeResourceOverview @nodes-change="onNodesChange" />
            <SteamcmdPanel @state-change="onSteamcmdStateChange" />
          </div>
        </NCollapseItem>
      </NCollapse>
    </FaPageMain>
    <InstanceManagement
      :nodes="nodes"
      :steamcmd-installed="steamcmdInstalled"
    />
  </div>
</template>
