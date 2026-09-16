<script setup lang="ts">
import type { ClusterOnlinePlayersDto } from '@/api/modules/cluster'
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NCard, NEmpty, NTag } from 'naive-ui'
import { computed } from 'vue'
import { routeToDstPlayerManage } from '@/navigation/game-routes'

const props = defineProps<{
  instance: InstanceItem | null
  /** 来自详情页轮询：players 为 null 表示这次没取到，与「没人在线」不是一回事 */
  onlinePlayers: ClusterOnlinePlayersDto | null
}>()

defineOptions({
  name: 'InstanceDetailOnlinePlayersCard',
})

const router = useRouter()

const running = computed(() => Boolean(props.onlinePlayers?.running))
const players = computed(() => props.onlinePlayers?.players ?? null)

const hasPlayers = computed(() => Boolean(players.value && players.value.length > 0))

/** 有在线记录却列不出来的人数（游戏没给出可用 ID），与概览的人数读数同源 */
const unlistedCount = computed(() => props.onlinePlayers?.unlistedPlayerCount ?? 0)

const emptyDescription = computed(() => {
  if (!running.value) {
    return '房间未运行，启动后可在这里看到在线玩家'
  }
  if (players.value === null) {
    return '暂时取不到在线玩家，稍后会自动重试'
  }
  if (unlistedCount.value > 0) {
    // 概览的人数已经算上了这些人，这里必须说清楚，否则「1 人在线」与「没人」自相矛盾
    return `房间里有 ${unlistedCount.value} 人在线，但游戏没有给出可用的玩家 ID，列不出来`
  }
  return '当前没有玩家在线'
})

function displayName(name: string): string {
  return name.trim() || '（未取名）'
}

/** 没有 Klei 账号的玩家可能拿不到 ID，别显示成空白让人以为渲染坏了 */
function displayId(kuId: string): string {
  return kuId.trim() || '游戏未给出 ID'
}

/** 踢出、封禁与名单维护都在玩家管理页：入口唯一，避免操作分散在多个页面 */
function goPlayerManage() {
  if (props.instance) {
    router.push(routeToDstPlayerManage(props.instance.id))
  }
}
</script>

<template>
  <NCard title="在线玩家" size="small">
    <template #header-extra>
      <NButton size="tiny" secondary @click="goPlayerManage">
        管理玩家
      </NButton>
    </template>

    <NEmpty v-if="!hasPlayers" :description="emptyDescription" size="small" />
    <template v-else>
      <ul class="flex flex-col gap-2">
        <li
          v-for="player in players"
          :key="player.key"
          class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div class="min-w-0">
            <p class="text-sm truncate">
              {{ displayName(player.name) }}
              <NTag v-if="!player.kleiAccount" size="tiny" :bordered="false" class="ml-1">
                临时身份
              </NTag>
            </p>
            <p class="font-mono text-xs text-muted-foreground truncate">
              {{ displayId(player.kuId) }}
            </p>
          </div>
          <NTag size="tiny" :bordered="false">
            在线
          </NTag>
        </li>
      </ul>
      <p v-if="unlistedCount > 0" class="mt-2 text-xs text-muted-foreground">
        另有 {{ unlistedCount }} 人有在线记录，但游戏没有给出可用的玩家 ID，无法列出。
      </p>
    </template>
  </NCard>
</template>
