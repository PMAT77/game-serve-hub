<script setup lang="ts">
import { NTag } from 'naive-ui'
import { onMounted, ref } from 'vue'
import apiSystem from '@/api/modules/system'

defineOptions({
  name: 'NodeInstanceSteamcmdPanel',
})

const emit = defineEmits<{
  stateChange: [payload: { installed: boolean }]
}>()

const steamcmdInstalling = ref(false)
const steamcmdInstalled = ref(false)
const gameDstInstalled = ref(false)
const isDockerAvailable = ref(false)
const steamcmdImage = ref('')
const gameDstImage = ref('')
const installRoot = ref('')

function emitStateChange() {
  emit('stateChange', {
    installed: steamcmdInstalled.value,
  })
}

async function fetchSteamcmdConfig() {
  const res = await apiSystem.getSteamcmdConfig()
  steamcmdImage.value = res.data.steamcmdImage?.trim() || res.data.steamcmdPath?.trim() || ''
  gameDstImage.value = res.data.gameDstImage?.trim() || ''
  installRoot.value = res.data.installRoot?.trim() || ''
  isDockerAvailable.value = Boolean(res.data.isDockerAvailable)
  steamcmdInstalled.value = Boolean(res.data.isSteamcmdInstalled)
  gameDstInstalled.value = Boolean(res.data.isGameDstImageInstalled)
  emitStateChange()
}

async function ensureSteamcmdImage() {
  steamcmdInstalling.value = true
  try {
    const res = await apiSystem.installSteamcmd()
    faToast.success(res.data.message || '游戏安装镜像已就绪')
    await fetchSteamcmdConfig()
  }
  finally {
    steamcmdInstalling.value = false
  }
}

async function ensureGameDstImageManual() {
  steamcmdInstalling.value = true
  try {
    const res = await apiSystem.installGameDstImage()
    faToast.success(res.data.message || 'DST 运行镜像已就绪')
    await fetchSteamcmdConfig()
  }
  finally {
    steamcmdInstalling.value = false
  }
}

onMounted(() => {
  void fetchSteamcmdConfig()
})
</script>

<template>
  <FaPageMain title="容器镜像">
    <p class="mb-4 text-sm text-muted-foreground">
      管理游戏安装与运行所需的 Docker 镜像。首次创建实例会自动准备游戏安装镜像；也可在此提前拉取以缩短等待时间。
    </p>
    <div class="p-4 border border-border/70 rounded-lg bg-muted/20 space-y-4">
      <div class="flex flex-wrap gap-3 items-start justify-between">
        <div class="flex flex-wrap gap-2">
          <NTag size="small" :bordered="false" :type="isDockerAvailable ? 'success' : 'error'">
            {{ isDockerAvailable ? 'Docker 可用' : 'Docker 不可用' }}
          </NTag>
          <NTag size="small" :bordered="false" :type="steamcmdInstalled ? 'success' : 'default'">
            {{ steamcmdInstalled ? '游戏安装镜像已就绪' : '游戏安装镜像未就绪' }}
          </NTag>
          <NTag size="small" :bordered="false" :type="gameDstInstalled ? 'success' : 'warning'">
            {{ gameDstInstalled ? 'DST 运行镜像已就绪' : '安装实例后自动准备' }}
          </NTag>
        </div>
        <div class="flex flex-wrap gap-2">
          <NButton
            type="primary"
            secondary
            :loading="steamcmdInstalling"
            :disabled="!isDockerAvailable"
            @click="ensureSteamcmdImage"
          >
            预拉游戏安装镜像
          </NButton>
          <NButton
            v-if="!gameDstInstalled"
            type="default"
            secondary
            :loading="steamcmdInstalling"
            :disabled="!isDockerAvailable"
            @click="ensureGameDstImageManual"
          >
            手动拉取 DST 运行镜像
          </NButton>
        </div>
      </div>

      <div class="gap-3 grid md:grid-cols-2">
        <div class="space-y-1">
          <div class="text-xs text-muted-foreground">
            游戏安装镜像
          </div>
          <NInput
            :value="steamcmdImage"
            readonly
            placeholder="未配置"
          />
        </div>
        <div class="space-y-1">
          <div class="text-xs text-muted-foreground">
            游戏运行镜像
          </div>
          <NInput
            :value="gameDstImage"
            readonly
            placeholder="未配置"
          />
        </div>
        <div class="space-y-1 md:col-span-2">
          <div class="text-xs text-muted-foreground">
            实例数据目录
          </div>
          <NInput
            :value="installRoot"
            readonly
            placeholder="未配置"
          />
        </div>
      </div>

      <p
        v-if="!steamcmdInstalled && isDockerAvailable"
        class="text-xs text-amber-600 dark:text-amber-400"
      >
        首次创建实例时会自动拉取游戏安装镜像；提前拉取可减少创建等待时间。
      </p>
      <p
        v-if="!isDockerAvailable"
        class="text-xs text-rose-600 dark:text-rose-400"
      >
        面板进程无法连接 Docker。请确认 Docker 已启动，且 Compose 部署时已挂载 Docker 套接字。
      </p>
    </div>
  </FaPageMain>
</template>
