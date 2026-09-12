<script setup lang="ts">
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type { BackupItem } from '@/api/modules/backup'
import type { InstanceItem } from '@/api/modules/instance'
import { NAlert, NButton, NDataTable, NEmpty, NInput, NModal, NSpace, NSelect, NTag, NTooltip, useDialog } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import apiBackup from '@/api/modules/backup'
import apiInstance from '@/api/modules/instance'
import { useAdminPageState } from '@/composables/useAdminPageState'
import SaveImportModal from './components/SaveImportModal.vue'

defineOptions({
  name: 'OpsBackups',
})

const dialog = useDialog()
const appSettingsStore = useAppSettingsStore()

const rows = ref<BackupItem[]>([])
const instances = ref<InstanceItem[]>([])
const selectedInstanceId = ref<string | null>(null)
const isMobileMode = computed(() => appSettingsStore.mode === 'mobile')

const {
  loading,
  error,
  showError,
  runLoad,
} = useAdminPageState(rows)

const kindMeta: Record<BackupItem['kind'], { label: string, type: 'default' | 'info' | 'warning' | 'error' | 'success' }> = {
  manual: { label: '手动', type: 'info' },
  scheduled: { label: '计划', type: 'default' },
  pre_update: { label: '更新前', type: 'warning' },
  pre_delete: { label: '删除前', type: 'warning' },
  pre_restore: { label: '恢复前', type: 'default' },
  pre_import: { label: '导入前', type: 'warning' },
  database: { label: '面板数据备份', type: 'success' },
}

const statusMeta: Record<BackupItem['status'], { label: string, type: 'default' | 'info' | 'warning' | 'error' | 'success' }> = {
  completed: { label: '可用', type: 'success' },
  failed: { label: '失败', type: 'error' },
  stale: { label: '文件丢失', type: 'error' },
}

function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '—'
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '—'
}

/**
 * 创建者展示：正常为登录账号；计划任务由调度器自动执行、没有账号，
 * 因此后端写入固定标识 'scheduler'（server 端 SCHEDULED_OPERATOR），此处显示为中文。
 */
function formatCreator(createdBy: string): string {
  if (!createdBy) {
    return '—'
  }
  return createdBy === 'scheduler' ? '计划任务' : createdBy
}

function instanceName(instanceId: string): string {
  if (instanceId === 'panel-db') {
    return '面板'
  }
  return instances.value.find(item => item.id === instanceId)?.name ?? instanceId
}

const instanceOptions = computed<SelectOption[]>(() => {
  return instances.value.map(item => ({
    label: item.name,
    value: item.id,
  }))
})

function triggerLoad() {
  runLoad(async () => {
    const [backupResponse, instanceResponse] = await Promise.all([
      apiBackup.getBackupList(selectedInstanceId.value ?? undefined),
      apiInstance.getInstanceList().catch(() => ({ data: [] as InstanceItem[] })),
    ])
    rows.value = backupResponse.data ?? []
    instances.value = instanceResponse.data ?? []
  })
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleDownload(row: BackupItem) {
  apiBackup.downloadBackup({ backupId: row.id }).then((response) => {
    saveBlob(response.data, row.fileName)
  }).catch(() => {
    faToast.error('下载失败，请稍后重试')
  })
}

const createDialogVisible = ref(false)
const createDialogNote = ref('')
const importModalVisible = ref(false)

function openCreateBackupDialog() {
  if (!selectedInstanceId.value || selectedInstanceId.value === 'panel-db') {
    faToast.info('请先在上方选择要备份的实例')
    return
  }
  createDialogNote.value = ''
  createDialogVisible.value = true
}

async function submitCreateBackup() {
  const instanceId = selectedInstanceId.value
  if (!instanceId) {
    return
  }
  createDialogVisible.value = false
  try {
    await apiBackup.createBackup(instanceId, createDialogNote.value)
    faToast.success('备份创建成功')
    triggerLoad()
  }
  catch (err) {
    const message = err instanceof Error ? err.message : '备份创建失败'
    faToast.error(message)
  }
}

function handleCreateDbBackup() {
  dialog.warning({
    title: '备份面板数据',
    content: '备份面板账号与设置，期间请勿关闭面板。',
    positiveText: '开始备份',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await apiBackup.createDbBackup()
        faToast.success('面板数据备份已创建')
        triggerLoad()
      }
      catch (err) {
        const message = err instanceof Error ? err.message : '面板数据备份失败'
        faToast.error(message)
      }
    },
  })
}

function handleRestore(row: BackupItem) {
  dialog.error({
    title: '确认恢复存档',
    content: `将把实例「${instanceName(row.instanceId)}」的存档回滚到 ${formatTime(row.createdAt)} 的备份点。恢复前会自动创建一份安全备份。请先停止实例，运行中无法恢复。`,
    positiveText: '确认恢复',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const response = await apiBackup.restoreBackup(row.id)
        const safetyId = response.data.safetyBackupId
        faToast.success(safetyId ? '恢复完成（已自动创建恢复前安全备份）' : '恢复完成，可启动实例验证世界状态')
        triggerLoad()
      }
      catch (err) {
        const message = err instanceof Error ? err.message : '恢复失败'
        faToast.error(message)
      }
    },
  })
}

function handleDelete(row: BackupItem) {
  dialog.warning({
    title: '确认删除备份',
    content: `将删除备份「${row.fileName}」及其文件，删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await apiBackup.deleteBackup(row.id)
        faToast.success('备份已删除')
        triggerLoad()
      }
      catch (err) {
        const message = err instanceof Error ? err.message : '删除失败'
        faToast.error(message)
      }
    },
  })
}

const columns = computed<DataTableColumns<BackupItem>>(() => [
  {
    title: '备份文件',
    key: 'fileName',
    minWidth: 220,
    ellipsis: { tooltip: true },
  },
  {
    title: '实例',
    key: 'instanceId',
    width: 140,
    ellipsis: { tooltip: true },
    render: row => instanceName(row.instanceId),
  },
  {
    title: '类型',
    key: 'kind',
    width: 110,
    render: row => h(
      NTag,
      { size: 'small', bordered: false, type: kindMeta[row.kind].type },
      { default: () => kindMeta[row.kind].label },
    ),
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: row => h(
      NTag,
      { size: 'small', bordered: false, type: statusMeta[row.status].type },
      { default: () => statusMeta[row.status].label },
    ),
  },
  {
    title: '大小',
    key: 'sizeBytes',
    width: 100,
    align: 'right',
    render: row => formatSize(row.sizeBytes),
  },
  {
    title: '备注',
    key: 'note',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: row => row.note || '—',
  },
  {
    title: '创建者',
    key: 'createdBy',
    width: 120,
    render: row => formatCreator(row.createdBy),
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 180,
    render: row => formatTime(row.createdAt),
  },
  {
    title: '操作',
    key: 'actions',
    width: 190,
    render: (row) => {
      const buttons = []
      if (row.status === 'completed') {
        buttons.push(h(NButton, {
          size: 'small',
          quaternary: true,
          type: 'primary',
          onClick: () => handleDownload(row),
        }, { default: () => '下载' }))
      }
      if (row.kind !== 'database' && row.status === 'completed') {
        buttons.push(h(NTooltip, { trigger: 'hover' }, {
          trigger: () => h(NButton, {
            size: 'small',
            quaternary: true,
            type: 'warning',
            onClick: () => handleRestore(row),
          }, { default: () => '恢复' }),
          default: () => '回滚该实例存档到此备份点（实例须已停止）',
        }))
      }
      buttons.push(h(NButton, {
        size: 'small',
        quaternary: true,
        type: 'error',
        onClick: () => handleDelete(row),
      }, { default: () => '删除' }))
      return h('div', { style: 'display:flex;gap:4px' }, buttons)
    },
  },
])

onMounted(() => {
  triggerLoad()
})
</script>

<template>
  <div class="page-container" :class="{ mobile: isMobileMode }">
    <div class="page-header">
      <h2>备份与恢复</h2>
      <p class="page-description">
        备份实例存档与面板数据，可恢复、下载与清理旧备份。
        恢复会整体替换实例存档，请先停止实例。
      </p>
    </div>

    <NSpace :size="8" align="center" class="flex-wrap">
      <NSelect
        v-model:value="selectedInstanceId"
        :options="instanceOptions"
        placeholder="全部实例"
        clearable
        filterable
        style="width: 220px"
        @update:value="triggerLoad"
      />
      <NButton
        type="primary"
        strong
        secondary
        :disabled="!selectedInstanceId || selectedInstanceId === 'panel-db'"
        @click="openCreateBackupDialog"
      >
        创建存档备份
      </NButton>
      <NButton
        type="warning"
        strong
        secondary
        :disabled="!selectedInstanceId || selectedInstanceId === 'panel-db'"
        @click="importModalVisible = true"
      >
        导入外部存档
      </NButton>
      <NButton @click="handleCreateDbBackup">
        备份面板数据
      </NButton>
      <NButton :loading="loading" @click="triggerLoad">
        刷新
      </NButton>
    </NSpace>

    <div v-if="showError" class="space-y-3" role="alert">
      <NAlert type="error" title="加载失败">
        {{ error }}
      </NAlert>
      <NButton size="small" @click="triggerLoad">
        重试
      </NButton>
    </div>
    <NDataTable
      v-else
      :columns="columns"
      :data="rows"
      :loading="loading"
      :scroll-x="1200"
      :row-key="(row: BackupItem) => row.id"
    >
      <template #empty>
        <NEmpty size="large" description="暂无备份，选择实例后点击「创建存档备份」" />
      </template>
    </NDataTable>

    <NModal
      v-model:show="createDialogVisible"
      preset="dialog"
      type="warning"
      title="创建存档备份"
      positive-text="开始备份"
      negative-text="取消"
      @positive-click="submitCreateBackup"
    >
      <div style="display: flex; flex-direction: column; gap: 8px">
        <p style="margin: 0">
          将为实例「{{ instanceName(selectedInstanceId ?? '') }}」创建完整的存档备份。
        </p>
        <p style="margin: 0; color: #909090">
          运行中会先让世界保存一次再打包。
        </p>
        <NInput
          v-model:value="createDialogNote"
          placeholder="备注（可选，最多 200 字）"
          maxlength="200"
        />
      </div>
    </NModal>

    <SaveImportModal
      v-model:show="importModalVisible"
      :instance-id="selectedInstanceId && selectedInstanceId !== 'panel-db' ? selectedInstanceId : null"
      :instance-name="instanceName(selectedInstanceId ?? '')"
      @imported="triggerLoad"
    />
  </div>
</template>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.page-container.mobile {
  padding: 12px;
}

.page-header h2 {
  margin: 0;
}

.page-description {
  margin: 4px 0 0;
  color: var(--custom-text-color-secondary, #909090);
  font-size: 13px;
}
</style>
