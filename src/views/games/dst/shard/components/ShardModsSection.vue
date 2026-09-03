<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import type { ModItemDto } from '@/api/modules/mod'
import { NButton, NDataTable, NSelect, NTag, NTooltip, useMessage } from 'naive-ui'
import { computed, h, ref, watch } from 'vue'
import AdminSettingsSection from '@/components/AdminSettingsSection.vue'
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
  return installedMods.value
})

function renderInstallStatus(row: ModItemDto) {
  if (row.installStatus === 'pending') {
    return h(NTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '下载中' })
  }
  if (row.installStatus === 'failed') {
    return h(NTag, { size: 'small', bordered: false, type: 'error' }, { default: () => '下载失败' })
  }
  return h(NTag, { size: 'small', bordered: false, type: 'success' }, { default: () => '已就绪' })
}

const installedColumns: DataTableColumns<ModItemDto> = [
  { title: 'Mod 名称', key: 'name', minWidth: 220, render: row => row.name },
  { title: '创意工坊 ID', key: 'workshopId', width: 170, render: row => row.workshopId },
  {
    title: '安装状态',
    key: 'installStatus',
    width: 110,
    render: row => renderInstallStatus(row),
  },
  {
    title: '开关状态',
    key: 'enabled',
    width: 110,
    render: (row) => {
      if (row.installStatus !== 'ready') {
        return h('span', { class: 'text-xs text-muted-foreground' }, '-')
      }
      return h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type: row.enabled ? 'success' : 'default',
        },
        { default: () => (row.enabled ? '已开启' : '已关闭') },
      )
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: row => h(
      NTooltip,
      {
        disabled: row.installStatus === 'ready',
      },
      {
        trigger: () => h(
          NButton,
          {
            size: 'small',
            type: row.enabled ? 'warning' : 'primary',
            ghost: true,
            loading: mutatingWorkshopIds.value.has(row.workshopId),
            disabled: !hasInstanceId.value
              || mutatingWorkshopIds.value.has(row.workshopId)
              || row.installStatus !== 'ready',
            onClick: () => void toggleModEnabled(row),
          },
          { default: () => (row.enabled ? '关闭' : '开启') },
        ),
        default: () => (row.installStatus === 'failed'
          ? '下载失败，请前往 Mod 管理重试'
          : '下载完成后方可开启'),
      },
    ),
  },
]

async function loadInstalledMods() {
  const targetId = props.instanceId
  if (!targetId.trim()) {
    installedMods.value = []
    resetState()
    return
  }
  loadingInstalled.value = true
  try {
    const response = await apiMod.getModList(targetId)
    // 快速切换实例时丢弃过期响应，避免旧实例数据覆盖新实例的 Mod 列表
    if (props.instanceId !== targetId) {
      return
    }
    installedMods.value = response.data.mods
    await restoreInstallJobs({ modList: response.data })
  }
  finally {
    if (props.instanceId === targetId) {
      loadingInstalled.value = false
    }
  }
}

async function toggleModEnabled(item: ModItemDto) {
  if (!hasInstanceId.value || mutatingWorkshopIds.value.has(item.workshopId) || item.installStatus !== 'ready') {
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

    <AdminSettingsSection
      title="已订阅 Mod"
      description="管理当前实例已订阅 Mod 的开启状态；新订阅默认关闭，需在此手动开启。下载未完成时请到 Mod 管理处理。"
    />

    <div class="flex flex-wrap items-center gap-3">
      <NSelect
        v-model:value="modEnabledFilter"
        :options="modEnabledFilterOptions"
        class="w-36"
      />
      <NButton :disabled="loadingInstalled" @click="loadInstalledMods">
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
