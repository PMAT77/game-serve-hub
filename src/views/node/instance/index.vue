<script setup lang="ts">
import type { NodeListItem } from '@/api/modules/node'
import { ref } from 'vue'
import InstanceManagement from './components/InstanceManagement.vue'
import NodeResourceOverview from './components/NodeResourceOverview.vue'
import SteamcmdPanel from './components/SteamcmdPanel.vue'

defineOptions({
  name: 'NodeInstanceManagement',
})

const nodes = ref<NodeListItem[]>([])
const steamcmdInstalled = ref(false)
const steamcmdConfigured = ref(false)

function onNodesChange(list: NodeListItem[]) {
  nodes.value = list
}

function onSteamcmdStateChange(payload: { installed: boolean, configured: boolean }) {
  steamcmdInstalled.value = payload.installed
  steamcmdConfigured.value = payload.configured
}
</script>

<template>
  <div class="space-y-4">
    <NodeResourceOverview @nodes-change="onNodesChange" />
    <SteamcmdPanel @state-change="onSteamcmdStateChange" />
    <InstanceManagement
      :nodes="nodes"
      :steamcmd-installed="steamcmdInstalled"
      :steamcmd-configured="steamcmdConfigured"
    />
  </div>
</template>
