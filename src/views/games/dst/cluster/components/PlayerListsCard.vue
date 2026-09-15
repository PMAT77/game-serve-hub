<script setup lang="ts">
import type { PlayerListKind } from '@/api/modules/player'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NSpin,
  NTabPane,
  NTabs,
  useMessage,
} from 'naive-ui'
import { computed, reactive, ref, watch } from 'vue'
import apiPlayer from '@/api/modules/player'

const props = defineProps<{
  instanceId: string
  /** 白名单预留位；为 0 时白名单不生效 */
  whitelistSlots: number
}>()

defineOptions({
  name: 'DstPlayerListsCard',
})

const message = useMessage()

const KU_ID_PATTERN = /^KU_[A-Za-z0-9_]{1,64}$/i

const LIST_META: { kind: PlayerListKind, label: string, hint: string }[] = [
  { kind: 'admin', label: '管理员', hint: '管理员可在游戏内使用控制台命令。' },
  { kind: 'whitelist', label: '白名单', hint: '预留位大于 0 时，白名单用于给指定玩家保留席位。' },
  { kind: 'block', label: '黑名单', hint: '名单内的玩家无法加入房间。' },
]

interface ListState {
  entries: string[]
  fileExists: boolean
  loading: boolean
  saving: boolean
  input: string
  error: string | null
}

function createListState(): ListState {
  return {
    entries: [],
    fileExists: false,
    loading: false,
    saving: false,
    input: '',
    error: null,
  }
}

const activeKind = ref<PlayerListKind>('admin')
const lists = reactive<Record<PlayerListKind, ListState>>({
  admin: createListState(),
  whitelist: createListState(),
  block: createListState(),
})

function labelOf(kind: PlayerListKind): string {
  return LIST_META.find(item => item.kind === kind)?.label ?? ''
}

const whitelistDisabled = computed(() => props.whitelistSlots <= 0)

async function loadList(kind: PlayerListKind) {
  const state = lists[kind]
  state.loading = true
  state.error = null
  try {
    const { data } = await apiPlayer.getPlayerList(props.instanceId, kind)
    state.entries = data.entries.map(entry => entry.kuId)
    state.fileExists = data.fileExists
  }
  catch {
    state.entries = []
    state.error = '读取失败，请确认实例已安装后重试。'
  }
  finally {
    state.loading = false
  }
}

async function loadAll() {
  if (!props.instanceId) {
    return
  }
  await Promise.all(LIST_META.map(item => loadList(item.kind)))
}

async function persist(kind: PlayerListKind, nextEntries: string[]): Promise<boolean> {
  const state = lists[kind]
  state.saving = true
  try {
    const { data } = await apiPlayer.savePlayerList({
      instanceId: props.instanceId,
      kind,
      entries: nextEntries.map(kuId => ({ kuId })),
    })
    state.entries = data.entries.map(entry => entry.kuId)
    state.fileExists = true
    return true
  }
  catch {
    message.error('保存失败，请稍后重试。')
    return false
  }
  finally {
    state.saving = false
  }
}

async function addEntry(kind: PlayerListKind) {
  const state = lists[kind]
  const value = state.input.trim()
  if (!KU_ID_PATTERN.test(value)) {
    message.warning('请填写 KU_ 开头的玩家 ID')
    return
  }
  if (state.entries.some(item => item.toLowerCase() === value.toLowerCase())) {
    message.warning('该玩家已在名单中')
    return
  }
  if (await persist(kind, [...state.entries, value])) {
    state.input = ''
    message.success(`已加入${labelOf(kind)}名单`)
  }
}

async function removeEntry(kind: PlayerListKind, kuId: string) {
  const state = lists[kind]
  if (await persist(kind, state.entries.filter(item => item !== kuId))) {
    message.success(`已移出${labelOf(kind)}名单`)
  }
}

watch(() => props.instanceId, () => {
  void loadAll()
}, { immediate: true })
</script>

<template>
  <NCard title="玩家名单" size="small" class="mt-4">
    <template #header-extra>
      <span class="text-xs text-muted-foreground">修改后会立即保存</span>
    </template>
    <p class="mb-3 text-xs text-muted-foreground">
      名单按玩家 ID 记录。玩家 ID 可在游戏内的玩家信息或服务器日志中找到，形如 KU_ 开头的一串字符。
      房间运行中修改名单，建议重启房间后再确认生效。
    </p>
    <NTabs v-model:value="activeKind" type="line" animated>
      <NTabPane
        v-for="item in LIST_META"
        :key="item.kind"
        :name="item.kind"
        :tab="`${item.label}（${lists[item.kind].entries.length}）`"
      >
        <NAlert
          v-if="item.kind === 'whitelist' && whitelistDisabled"
          type="warning"
          :bordered="false"
          class="mb-3"
        >
          白名单当前未启用：白名单预留位为 0。请在下方「白名单预留位」填一个大于 0 的数字并保存房间设置。
        </NAlert>

        <div class="flex items-center gap-2">
          <NInput
            v-model:value="lists[item.kind].input"
            :placeholder="`${item.label}玩家 ID，例如 KU_abc123`"
            class="max-w-80"
            :disabled="lists[item.kind].saving"
            @keyup.enter="addEntry(item.kind)"
          />
          <NButton
            type="primary"
            :loading="lists[item.kind].saving"
            :disabled="!lists[item.kind].input.trim()"
            @click="addEntry(item.kind)"
          >
            加入名单
          </NButton>
        </div>

        <p class="mt-2 text-xs text-muted-foreground">
          {{ item.hint }}
          <template v-if="!lists[item.kind].fileExists && !lists[item.kind].loading">
            当前还没有任何条目。
          </template>
        </p>

        <NSpin :show="lists[item.kind].loading" class="mt-3 block">
          <p v-if="lists[item.kind].error" class="text-sm text-rose-600 dark:text-rose-400">
            {{ lists[item.kind].error }}
          </p>
          <NEmpty
            v-else-if="lists[item.kind].entries.length === 0"
            size="small"
            description="名单为空"
          />
          <ul v-else class="flex flex-col gap-1">
            <li
              v-for="kuId in lists[item.kind].entries"
              :key="kuId"
              class="flex items-center justify-between rounded-md border px-3 py-1.5"
            >
              <span class="font-mono text-sm">{{ kuId }}</span>
              <NButton
                text
                type="error"
                size="small"
                :disabled="lists[item.kind].saving"
                @click="removeEntry(item.kind, kuId)"
              >
                移出
              </NButton>
            </li>
          </ul>
        </NSpin>
      </NTabPane>
    </NTabs>
  </NCard>
</template>
