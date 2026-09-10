<script setup lang="ts">
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type { NotifyChannelItem, NotifyChannelType, NotifySettings } from '@/api/modules/notify'
import { NButton, NDataTable, NForm, NFormItem, NInput, NInputNumber, NModal, NSelect, NSpace, NSwitch, NTag, NTooltip, useDialog } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import apiNotify from '@/api/modules/notify'

defineOptions({
  name: 'SystemNotify',
})

const dialog = useDialog()

const rows = ref<NotifyChannelItem[]>([])
const settings = ref<NotifySettings>({
  enabled: true,
  cooldownMinutes: 15,
  thresholds: { cpuPercent: 90, memPercent: 90, diskPercent: 90 },
})
const settingsSaving = ref(false)
const tableLoading = ref(false)

const typeMeta: Record<NotifyChannelType, { label: string, hint: string }> = {
  dingtalk: { label: '钉钉群机器人', hint: '粘贴钉钉群机器人的 Webhook 地址；如开启加签，请同时填写加签密钥' },
  wecom: { label: '企业微信群机器人', hint: '粘贴企业微信群机器人的 Webhook 地址' },
  feishu: { label: '飞书群机器人', hint: '粘贴飞书自定义机器人的 Webhook 地址' },
  serverchan: { label: 'Server酱', hint: '填写 Server酱（sct.ftqq.com）的 SendKey，通知将推送到你的微信' },
  pushplus: { label: 'PushPlus', hint: '填写 PushPlus（pushplus.plus）的 token，通知将推送到你的微信' },
}

const typeOptions: SelectOption[] = (Object.keys(typeMeta) as NotifyChannelType[]).map(type => ({
  label: typeMeta[type].label,
  value: type,
}))

const healthMeta: Record<NotifyChannelItem['healthStatus'], { label: string, type: 'default' | 'error' | 'success' }> = {
  healthy: { label: '正常', type: 'success' },
  failing: { label: '连续失败', type: 'error' },
}

async function loadAll() {
  tableLoading.value = true
  try {
    const [channelResponse, settingsResponse] = await Promise.all([
      apiNotify.getChannelList(),
      apiNotify.getSettings().catch(() => ({ data: settings.value })),
    ])
    rows.value = channelResponse.data ?? []
    settings.value = settingsResponse.data
  }
  finally {
    tableLoading.value = false
  }
}

onMounted(() => {
  loadAll()
})

async function saveSettings() {
  settingsSaving.value = true
  try {
    await apiNotify.saveSettings(settings.value)
    faToast.success('通知设置已保存')
  }
  catch {
    faToast.error('保存失败，请稍后重试')
  }
  finally {
    settingsSaving.value = false
  }
}

// ---------------------------------------------------------------------------
// 渠道编辑
// ---------------------------------------------------------------------------

const editorVisible = ref(false)
const editorIsEdit = ref(false)
const editorChannelId = ref('')
const editorType = ref<NotifyChannelType>('dingtalk')
const editorName = ref('')
const editorWebhookUrl = ref('')
const editorSecret = ref('')
const editorSendKey = ref('')
const editorToken = ref('')
/** 编辑时已配置的键（留空=保留原值） */
const editorConfigured = ref<string[]>([])

const editorFields = computed(() => {
  if (editorType.value === 'serverchan') {
    return ['sendKey']
  }
  if (editorType.value === 'pushplus') {
    return ['token']
  }
  if (editorType.value === 'dingtalk') {
    return ['webhookUrl', 'secret']
  }
  return ['webhookUrl']
})

function isConfigured(key: string): boolean {
  return editorIsEdit.value && editorConfigured.value.includes(key)
}

function fieldPlaceholder(key: string): string {
  return isConfigured(key) ? '已配置（留空保留原值）' : ''
}

function openCreateDialog() {
  editorIsEdit.value = false
  editorChannelId.value = ''
  editorType.value = 'dingtalk'
  editorName.value = ''
  editorWebhookUrl.value = ''
  editorSecret.value = ''
  editorSendKey.value = ''
  editorToken.value = ''
  editorConfigured.value = []
  editorVisible.value = true
}

function openEditDialog(item: NotifyChannelItem) {
  editorIsEdit.value = true
  editorChannelId.value = item.id
  editorType.value = item.type
  editorName.value = item.name
  editorWebhookUrl.value = ''
  editorSecret.value = ''
  editorSendKey.value = ''
  editorToken.value = ''
  editorConfigured.value = item.configPreview.filter(preview => preview.configured).map(preview => preview.key)
  editorVisible.value = true
}

async function submitEditor() {
  const config: Record<string, string> = {}
  for (const key of editorFields.value) {
    const value = key === 'webhookUrl'
      ? editorWebhookUrl.value.trim()
      : key === 'secret'
        ? editorSecret.value.trim()
        : key === 'sendKey'
          ? editorSendKey.value.trim()
          : editorToken.value.trim()
    if (value || isConfigured(key)) {
      config[key] = value
    }
  }
  try {
    if (editorIsEdit.value) {
      await apiNotify.updateChannel({
        channelId: editorChannelId.value,
        name: editorName.value.trim(),
        config,
      })
      faToast.success('渠道已更新')
    }
    else {
      await apiNotify.createChannel({
        type: editorType.value,
        name: editorName.value.trim(),
        config,
      })
      faToast.success('渠道已创建，建议发送测试消息验证连通性')
    }
    editorVisible.value = false
    loadAll()
  }
  catch (error) {
    faToast.error(error instanceof Error ? error.message : '保存失败，请检查配置')
  }
}

async function toggleEnabled(item: NotifyChannelItem, enabled: boolean) {
  try {
    await apiNotify.updateChannel({ channelId: item.id, enabled })
    item.enabled = enabled
    faToast.success(enabled ? '渠道已启用' : '渠道已停用')
  }
  catch {
    faToast.error('操作失败，请稍后重试')
  }
}

function testChannel(item: NotifyChannelItem) {
  tableLoading.value = true
  apiNotify.testChannel({ channelId: item.id }).then((response) => {
    faToast.success(response.data.message ?? '测试消息已发送')
  }).catch(() => {
    faToast.error('测试发送失败，请检查配置与网络连通性')
  }).finally(() => {
    tableLoading.value = false
  })
}

function removeChannel(item: NotifyChannelItem) {
  dialog.error({
    title: '删除通知渠道',
    content: `确定删除「${item.name}」？删除后该渠道不再接收通知。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await apiNotify.deleteChannel({ channelId: item.id })
      faToast.success('已删除')
      loadAll()
    },
  })
}

const columns = computed<DataTableColumns<NotifyChannelItem>>(() => [
  {
    title: '类型',
    key: 'type',
    width: 130,
    render: row => h(NTag, { size: 'small', bordered: false }, { default: () => typeMeta[row.type].label }),
  },
  { title: '名称', key: 'name', minWidth: 140 },
  {
    title: '健康状态',
    key: 'healthStatus',
    width: 110,
    render: (row) => {
      const meta = healthMeta[row.healthStatus]
      const tag = h(NTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.label })
      if (!row.lastErrorMessage) {
        return tag
      }
      return h(NTooltip, null, {
        trigger: () => tag,
        default: () => `${row.lastErrorMessage}（${row.lastErrorAt?.replace('T', ' ').slice(0, 19) ?? ''}）`,
      })
    },
  },
  {
    title: '启用',
    key: 'enabled',
    width: 80,
    render: row => h(NSwitch, {
      value: row.enabled,
      size: 'small',
      onUpdateValue: (value: boolean) => toggleEnabled(row, value),
    }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 190,
    render: row => h(NSpace, { size: 8, wrap: false }, {
      default: () => [
        h(NButton, { size: 'small', secondary: true, disabled: !row.enabled, onClick: () => testChannel(row) }, { default: () => '测试' }),
        h(NButton, { size: 'small', secondary: true, onClick: () => openEditDialog(row) }, { default: () => '编辑' }),
        h(NButton, { size: 'small', secondary: true, type: 'error', onClick: () => removeChannel(row) }, { default: () => '删除' }),
      ],
    }),
  },
])
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <NForm label-placement="top" class="max-w-[560px]" @submit.prevent="saveSettings">
      <NFormItem label="通知总开关">
        <NSwitch v-model:value="settings.enabled" />
      </NFormItem>
      <NFormItem label="冷却窗口（分钟，同实例同事件在窗口内不重复推送）">
        <NInputNumber v-model:value="settings.cooldownMinutes" :min="1" :max="1440" :step="1" class="w-full" />
      </NFormItem>
      <NFormItem label="CPU 告警阈值（%）">
        <NInputNumber v-model:value="settings.thresholds.cpuPercent" :min="1" :max="100" class="w-full" />
      </NFormItem>
      <NFormItem label="内存告警阈值（%）">
        <NInputNumber v-model:value="settings.thresholds.memPercent" :min="1" :max="100" class="w-full" />
      </NFormItem>
      <NFormItem label="磁盘告警阈值（%）">
        <NInputNumber v-model:value="settings.thresholds.diskPercent" :min="1" :max="100" class="w-full" />
      </NFormItem>
      <NButton type="primary" :loading="settingsSaving" @click="saveSettings">
        保存设置
      </NButton>
    </NForm>

    <div class="flex items-center justify-between">
      <div class="text-sm opacity-70">
        告警事件：实例异常退出、CPU/内存/磁盘超阈值、计划任务备份结果。渠道连续失败 5 次将标记为「连续失败」。
      </div>
      <NButton type="primary" @click="openCreateDialog">
        新建渠道
      </NButton>
    </div>

    <NDataTable
      :columns="columns"
      :data="rows"
      :loading="tableLoading"
      :pagination="false"
      size="small"
    />

    <NModal
      v-model:show="editorVisible"
      preset="card"
      :title="editorIsEdit ? '编辑通知渠道' : '新建通知渠道'"
      class="w-[520px] max-w-[92vw]"
      :mask-closable="false"
    >
      <NForm label-placement="top" @submit.prevent="submitEditor">
        <NFormItem label="渠道类型">
          <NSelect v-model:value="editorType" :options="typeOptions" :disabled="editorIsEdit" />
        </NFormItem>
        <NFormItem label="名称">
          <NInput v-model:value="editorName" placeholder="如：我的钉钉群" />
        </NFormItem>
        <NFormItem v-if="editorFields.includes('webhookUrl')" label="Webhook 地址">
          <NInput v-model:value="editorWebhookUrl" :placeholder="fieldPlaceholder('webhookUrl')" placeholder-class="opacity-40" />
        </NFormItem>
        <NFormItem v-if="editorFields.includes('secret')" label="加签密钥（可选）">
          <NInput v-model:value="editorSecret" :placeholder="fieldPlaceholder('secret')" />
        </NFormItem>
        <NFormItem v-if="editorFields.includes('sendKey')" label="SendKey">
          <NInput v-model:value="editorSendKey" :placeholder="fieldPlaceholder('sendKey')" />
        </NFormItem>
        <NFormItem v-if="editorFields.includes('token')" label="Token">
          <NInput v-model:value="editorToken" :placeholder="fieldPlaceholder('token')" />
        </NFormItem>
        <div class="mb-3 text-xs opacity-50">
          {{ typeMeta[editorType].hint }}
        </div>
        <NSpace justify="end">
          <NButton @click="editorVisible = false">
            取消
          </NButton>
          <NButton type="primary" @click="submitEditor">
            {{ editorIsEdit ? '保存' : '创建' }}
          </NButton>
        </NSpace>
      </NForm>
    </NModal>
  </div>
</template>
