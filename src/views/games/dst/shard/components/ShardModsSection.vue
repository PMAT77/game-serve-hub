<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ModItemDto } from '@/api/modules/mod'
import { NAlert, NButton, NDataTable, NSelect, NTag, useMessage } from 'naive-ui'
import { computed, h, ref, watch } from 'vue'
import apiMod from '@/api/modules/mod'
import { useInstanceModState } from '@/composables/useInstanceModState'

type ModEnabledFilter = 'all' | 'enabled' | 'disabled'

const props = defineProps<{
  instanceId: string
  memoryWarning?: string | null
}>()

const message = useMessage()
const loadingInstalled = ref(false)
const mutatingWorkshopIds = ref<Set<string>>(new Set())
const modEnabledFilter = ref<ModEnabledFilter>('all')

const installedMods = ref<ModItemDto[]>([])

const {
  downloadingMods,
  restoreInstallJobs,
  resetState,
} = useInstanceModState(() => props.instanceId)

const hasInstanceId = computed(() => Boolean(props.instanceId.trim()))
const modEnabledFilterOptions = [
  { label: '全部', value: 'all' as const },
  { label: '已开启', value: 'enabled' as const },
  { label: '未开启', value: 'disabled' as const },
]
const readyInstalledMods = computed(() =>
  installedMods.value.filter(row => row.installStatus === 'ready'),
)
const filteredInstalledMods = computed(() => {
  if (modEnabledFilter.value === 'enabled') {
    return readyInstalledMods.value.filter(row => row.enabled)
  }
  if (modEnabledFilter.value === 'disabled') {
    return readyInstalledMods.value.filter(row => !row.enabled)
  }
  return readyInstalledMods.value
})
const installedColumns: DataTableColumns<ModItemDto> = [
  { title: 'Mod 名称', key: 'name', minWidth: 260, render: row => row.name },
  { title: '创意工坊 ID', key: 'workshopId', width: 170, render: row => row.workshopId },
  {
    title: '当前状态',
    key: 'enabled',
    width: 110,
    render: row => h(
      NTag,
      {
        size: 'small',
        bordered: false,
        type: row.enabled ? 'success' : 'default',
      },
      { default: () => (row.enabled ? '已开启' : '已关闭') },
    ),
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: row => h(
      NButton,
      {
        size: 'small',
        type: row.enabled ? 'warning' : 'primary',
        ghost: true,
        loading: mutatingWorkshopIds.value.has(row.workshopId),
        disabled: !hasInstanceId.value || mutatingWorkshopIds.value.has(row.workshopId),
        onClick: () => void toggleModEnabled(row),
      },
      { default: () => (row.enabled ? '关闭' : '开启') },
    ),
  },
]

async function loadInstalledMods() {
  if (!hasInstanceId.value) {
    installedMods.value = []
    resetState()
    return
  }
  loadingInstalled.value = true
  try {
    const response = await apiMod.getModList(props.instanceId)
    installedMods.value = response.data.mods
    await restoreInstallJobs({ modList: response.data })
  }
  finally {
    loadingInstalled.value = false
  }
}

async function toggleModEnabled(item: ModItemDto) {
  if (!hasInstanceId.value || mutatingWorkshopIds.value.has(item.workshopId)) {
    return
  }
  const nextMutating = new Set(mutatingWorkshopIds.value)
  nextMutating.add(item.workshopId)
  mutatingWorkshopIds.value = nextMutating
  try {
    const response = await apiMod.updateMod(props.instanceId, item.workshopId, {
      enabled: !item.enabled,
    })
    const riskTip = response.data.riskTip?.trim()
    message.success(`${item.enabled ? '已关闭' : '已开启'}该 Mod，需手动重启实例后生效`)
    if (riskTip) {
      message.warning(riskTip)
    }
    installedMods.value = installedMods.value.map(row => (
      row.workshopId === item.workshopId
        ? { ...row, enabled: !row.enabled }
        : row
    ))
  }
  catch {
    message.error('更新 Mod 状态失败，请稍后重试')
  }
  finally {
    const next = new Set(mutatingWorkshopIds.value)
    next.delete(item.workshopId)
    mutatingWorkshopIds.value = next
  }
}

watch(() => props.instanceId, (value) => {
  resetState()
  if (!value.trim()) {
    installedMods.value = []
    return
  }
  void loadInstalledMods()
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <AppHostMemoryAlert
      v-if="memoryWarning"
      title="内存与模组"
      :message="memoryWarning"
    />

    <NAlert
      v-if="downloadingMods.length > 0"
      type="info"
      title="下载中的 Mod"
    >
      <p class="text-sm">
        有 {{ downloadingMods.length }} 个 Mod 正在下载，完成后会出现在下方列表中。
      </p>
    </NAlert>

    <NAlert type="info" title="已订阅 Mod 开关">
      <p class="text-sm">
        这里只展示当前实例已就绪的 Mod，可按需开启或关闭。新订阅 Mod 默认未开启，创建或调整世界时请在此手动开启。订阅新 Mod 请前往「Mod 管理」页面。
      </p>
    </NAlert>

    <div class="flex flex-wrap items-center gap-3">
      <NSelect
        v-model:value="modEnabledFilter"
        :options="modEnabledFilterOptions"
        class="w-36"
      />
      <NButton :loading="loadingInstalled" @click="loadInstalledMods">
        刷新列表
      </NButton>
    </div>

    <NDataTable
      :bordered="false"
      :single-line="false"
      :columns="installedColumns"
      :data="filteredInstalledMods"
      :loading="loadingInstalled"
      :pagination="false"
    />
  </div>
</template>
