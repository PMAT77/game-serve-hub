<script setup lang="ts">
import type { OperationAuditResult } from '@/api/modules/system'
import { NAlert, NSpin, NTag } from 'naive-ui'
import { onMounted, ref } from 'vue'
import apiSystem from '@/api/modules/system'
import { AUDIT_OUTCOME_META, formatAuditParams, formatAuditTime } from './auditDisplay'

defineOptions({
  name: 'SystemOperationAuditSection',
})

const loading = ref(false)
const operationAudit = ref<OperationAuditResult | null>(null)
const errorMessage = ref<string | null>(null)

/**
 * 面板操作记录：谁在什么时候改了什么。
 *
 * 与「插件」页的插件调用记录不是同一件事——那个记的是插件调用了宿主什么能力，
 * 这个记的是人对面板的写操作（含被拒的越权尝试），所以它跟着「系统设置」走。
 * 切 tab 会重新挂载本组件（`display-directive="if"`），因此不需要刷新按钮。
 */
async function loadAudit() {
  loading.value = true
  errorMessage.value = null
  try {
    const { data } = await apiSystem.getOperationAudit({ limit: 30 })
    operationAudit.value = data
  }
  catch {
    operationAudit.value = null
    errorMessage.value = '暂时读不到操作记录，不影响面板的任何功能。'
  }
  finally {
    loading.value = false
  }
}

onMounted(loadAudit)
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-muted-foreground">
      谁在什么时候改了什么：重启世界、改配置、删备份这类写操作都会留一条，权限不足被拒的尝试也记下。
    </p>

    <NAlert v-if="errorMessage" type="warning" :bordered="false">
      {{ errorMessage }}
    </NAlert>

    <NSpin :show="loading">
      <p v-if="operationAudit && operationAudit.records.length === 0" class="text-sm text-muted-foreground">
        还没有需要记录的写操作。
      </p>
      <template v-else-if="operationAudit">
        <ul class="space-y-1">
          <li
            v-for="record in operationAudit.records"
            :key="`${record.at}-${record.id}`"
            class="rounded-md border px-3 py-2 text-xs"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-muted-foreground">{{ formatAuditTime(record.at) }}</span>
              <span class="font-medium">{{ record.account || '未登录' }}</span>
              <span>{{ record.method }} {{ record.path }}</span>
              <NTag size="tiny" :bordered="false" :type="AUDIT_OUTCOME_META[record.outcome]?.type ?? 'default'">
                {{ AUDIT_OUTCOME_META[record.outcome]?.label ?? record.outcome }}
              </NTag>
              <span class="text-muted-foreground">{{ record.statusCode }} · {{ record.durationMs }} ms</span>
            </div>
            <div v-if="formatAuditParams(record.params)" class="mt-1 text-muted-foreground break-all">
              {{ formatAuditParams(record.params) }}
            </div>
          </li>
        </ul>
        <p class="mt-2 text-xs text-muted-foreground break-all">
          原始记录：{{ operationAudit.auditRoot }}
        </p>
      </template>
    </NSpin>
  </div>
</template>
