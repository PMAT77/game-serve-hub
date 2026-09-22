<script setup lang="ts">
import { NAlert, NButton, NCard, NSpin, useMessage } from 'naive-ui'
import { computed, ref } from 'vue'
import apiBackup from '@/api/modules/backup'
import { copyTextToClipboard } from '@/utils/copyToClipboard'

defineOptions({
  name: 'InstanceMigrationCard',
})

const props = defineProps<{
  instanceId: string
}>()

const message = useMessage()

const loadingReport = ref(false)
const exporting = ref(false)
const reportText = ref<string | null>(null)
const warnings = ref<string[]>([])
const fileName = ref('')

const hasWarnings = computed(() => warnings.value.length > 0)

/**
 * 「导出迁移包」和「备份」解决的不是同一件事：备份留在本机用于回档，
 * 迁移包是给**另一台机器**导入用的（含配置、Mod 清单与端口对照），
 * 所以这里单独成卡，避免和备份入口混在一起让人误以为两者等价。
 */
async function loadReport() {
  if (loadingReport.value) {
    return
  }
  loadingReport.value = true
  try {
    const { data } = await apiBackup.getMigrationReport(props.instanceId)
    reportText.value = data.reportText
    warnings.value = data.warnings
    fileName.value = data.fileName
  }
  catch {
    message.error('读取迁移报告失败：实例可能尚未启动过，或存档目录不可读。')
  }
  finally {
    loadingReport.value = false
  }
}

async function exportPack() {
  if (exporting.value) {
    return
  }
  exporting.value = true
  const pending = message.loading('正在打包存档，实例越大越慢，请不要关闭页面…', { duration: 0 })
  try {
    const { data } = await apiBackup.exportMigrationPack(props.instanceId)
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName.value || 'migration-pack.tar.gz'
    link.click()
    URL.revokeObjectURL(url)
    pending.destroy()
    message.success('迁移包已开始下载，同目录还有校验和与迁移报告')
    // 打包成功后顺手刷新报告，让界面上的风险项与刚导出的包一致
    await loadReport()
  }
  catch {
    pending.destroy()
    message.error('导出失败：实例可能尚未启动过（没有存档可导出），或磁盘空间不足。')
  }
  finally {
    exporting.value = false
  }
}

async function copyReport() {
  if (!reportText.value) {
    return
  }
  const ok = await copyTextToClipboard(reportText.value)
  if (ok) {
    message.success('迁移报告已复制')
    return
  }
  message.error('复制失败，请手动选中文本复制')
}
</script>

<template>
  <NCard title="迁移到其他机器" size="small">
    <div class="space-y-3">
      <p class="text-sm text-muted-foreground">
        把这个实例的存档、房间配置与 Mod 清单整理成一个压缩包，在另一台机器上创建实例后用「备份与恢复 → 导入存档」导入即可。压缩包里不含游戏本体与 Mod 文件，导入后由目标机器自行下载。
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <NButton size="small" :loading="loadingReport" @click="loadReport">
          检查迁移报告
        </NButton>
        <NButton size="small" type="primary" :loading="exporting" @click="exportPack">
          导出迁移包
        </NButton>
        <NButton v-if="reportText" size="small" @click="copyReport">
          复制报告
        </NButton>
      </div>

      <NSpin :show="loadingReport">
        <div v-if="reportText" class="space-y-3">
          <NAlert v-if="hasWarnings" type="warning" :bordered="false">
            <div class="text-sm font-medium">
              迁移前有 {{ warnings.length }} 项需要确认
            </div>
            <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              <li v-for="item in warnings" :key="item">
                {{ item }}
              </li>
            </ul>
          </NAlert>
          <NAlert v-else type="success" :bordered="false">
            未发现明显风险项，可以直接导出。
          </NAlert>
          <pre class="rounded-md border px-3 py-2 overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">{{ reportText }}</pre>
        </div>
      </NSpin>
    </div>
  </NCard>
</template>
