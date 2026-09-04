<script setup lang="ts">
import type { NodeListItem } from '@/api/modules/node'
import { ref, watch } from 'vue'
import InstanceManagement from './components/InstanceManagement.vue'
import NodeResourceOverview from './components/NodeResourceOverview.vue'
import SteamcmdPanel from './components/SteamcmdPanel.vue'

defineOptions({
  name: 'NodeInstanceManagement',
})

const nodes = ref<NodeListItem[]>([])
const steamcmdInstalled = ref(false)

/** 运行环境折叠面板：安装镜像未就绪时默认展开引导初始化，就绪后自动收起 */
const envExpandedNames = ref<string[]>(['env'])

watch(steamcmdInstalled, (installed) => {
  envExpandedNames.value = installed ? [] : ['env']
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
    <NCollapse v-model:expanded-names="envExpandedNames">
      <NCollapseItem name="env">
        <template #header>
          <span class="font-medium">运行环境与安装镜像</span>
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
    <InstanceManagement
      :nodes="nodes"
      :steamcmd-installed="steamcmdInstalled"
    />
  </div>
</template>
