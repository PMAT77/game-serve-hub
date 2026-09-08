<script setup lang="ts">
import type { SaveImportCandidate, SaveImportProbeResult, SaveImportResult, SaveImportTokenSource } from '@/api/modules/backup'
import { NAlert, NButton, NInput, NModal, NSelect, NSpin, NTag, useDialog } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import apiBackup from '@/api/modules/backup'
import DirectoryPathPicker from './DirectoryPathPicker.vue'

defineOptions({
  name: 'SaveImportModal',
})

const props = defineProps<{
  show: boolean
  instanceId: string | null
  instanceName: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'imported': []
}>()

const dialog = useDialog()

const sourcePath = ref('')
const pickerVisible = ref(false)
const probing = ref(false)
const submitting = ref(false)
const probeResult = ref<SaveImportProbeResult | null>(null)
const selectedPath = ref<string | null>(null)
const clusterToken = ref('')
const importResult = ref<SaveImportResult | null>(null)

const selectedCandidate = computed<SaveImportCandidate | null>(() => {
  const candidates = probeResult.value?.candidates ?? []
  return candidates.find(item => item.clusterPath === selectedPath.value) ?? null
})

const candidateOptions = computed<SelectOption[]>(() => {
  return (probeResult.value?.candidates ?? []).map((candidate) => {
    const label = candidate.clusterName
      ? candidate.dirName + '（' + candidate.clusterName + '）'
      : candidate.dirName
    return { label, value: candidate.clusterPath }
  })
})

const tokenSourceLabels: Record<SaveImportTokenSource, string> = {
  provided: '使用导入时填写的令牌',
  existing: '沿用实例已有令牌',
  source: '使用源存档自带的令牌文件',
  none: '未配置令牌（公网模式需到房间设置补填）',
}

const canProbe = computed(() => sourcePath.value.trim().length > 0)
const canSubmit = computed(() => Boolean(props.instanceId) && Boolean(selectedCandidate.value) && !submitting.value)

function resetForm() {
  sourcePath.value = ''
  probing.value = false
  submitting.value = false
  probeResult.value = null
  selectedPath.value = null
  clusterToken.value = ''
  importResult.value = null
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB'
  }
  if (bytes < 1024 * 1024 * 1024) {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  }
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function shardLabel(shard: 'master' | 'caves'): string {
  return shard === 'master' ? '主世界' : '洞穴'
}

async function doProbe() {
  probing.value = true
  probeResult.value = null
  selectedPath.value = null
  try {
    const response = await apiBackup.probeSaveImport(sourcePath.value.trim())
    probeResult.value = response.data
    const candidates = response.data.candidates ?? []
    if (candidates.length === 1) {
      selectedPath.value = candidates[0]!.clusterPath
    }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : '源目录探测失败'
    probeResult.value = { sourcePath: sourcePath.value.trim(), candidates: [], warnings: [message] }
  }
  finally {
    probing.value = false
  }
}

function confirmImport() {
  const candidate = selectedCandidate.value
  if (!candidate || !props.instanceId) {
    return
  }
  const content = '将把实例「' + props.instanceName + '」的世界存档整体替换为所选集群存档（'
    + candidate.dirName + '）。若实例已有存档，会先自动创建一份「导入前」安全备份，可在备份列表恢复回退。'
    + '导入要求实例已停止且已完成游戏安装。'
  dialog.warning({
    title: '确认导入存档',
    content,
    positiveText: '开始导入',
    negativeText: '取消',
    onPositiveClick: async () => {
      submitting.value = true
      try {
        const response = await apiBackup.importSave({
          instanceId: props.instanceId!,
          sourceClusterPath: candidate.clusterPath,
          ...(clusterToken.value.trim() ? { clusterToken: clusterToken.value.trim() } : {}),
        })
        importResult.value = response.data
        emit('imported')
      }
      catch (err) {
        const message = err instanceof Error ? err.message : '存档导入失败'
        faToast.error(message)
      }
      finally {
        submitting.value = false
      }
    },
  })
}

watch(() => props.show, (visible) => {
  if (visible) {
    resetForm()
  }
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="导入外部存档"
    style="width: min(720px, 94vw)"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="importer">
      <template v-if="!importResult">
        <NAlert type="info" :show-icon="false">
          将外部 Klei 存档目录（如 Documents/Klei/DoNotStarveTogether/Cluster_2）导入为所选实例的世界存档。
          世界进度与房间设置来自源档；端口会自动改写为本实例配置，避免与其它实例冲突。
        </NAlert>

        <div class="importer-field">
          <div class="importer-label">
            源存档目录
          </div>
          <div class="importer-path-row">
            <NInput
              v-model:value="sourcePath"
              size="small"
              placeholder="粘贴集群目录或其上级目录的绝对路径"
              @keyup.enter="doProbe"
            />
            <NButton size="small" @click="pickerVisible = true">
              浏览
            </NButton>
            <NButton size="small" type="primary" :loading="probing" :disabled="!canProbe" @click="doProbe">
              识别
            </NButton>
          </div>
          <div class="importer-hint">
            Linux 部署时目录浏览可能受限，可直接粘贴存档在面板宿主机上的绝对路径。
          </div>
        </div>

        <NSpin :show="probing">
          <div v-if="probeResult" class="importer-probe">
            <NAlert
              v-if="!probeResult.candidates || probeResult.candidates.length === 0"
              type="error"
              :show-icon="false"
            >
              {{ probeResult.warnings?.[0] ?? '未识别到可导入的集群存档' }}
            </NAlert>

            <template v-else>
              <div v-if="probeResult.candidates.length > 1" class="importer-field">
                <div class="importer-label">
                  识别到多个集群，选择要导入的存档
                </div>
                <NSelect
                  :value="selectedPath"
                  size="small"
                  :options="candidateOptions"
                  placeholder="选择集群存档"
                  @update:value="(value: string) => selectedPath = value"
                />
              </div>

              <div v-if="selectedCandidate" class="importer-candidate">
                <div class="importer-candidate-row">
                  <span class="importer-label">房间名</span>
                  <span>{{ selectedCandidate.clusterName ?? '未知（cluster.ini 解析失败）' }}</span>
                  <NTag
                    size="small"
                    :bordered="false"
                    :type="selectedCandidate.worldGenerated ? 'success' : 'default'"
                  >
                    {{ selectedCandidate.worldGenerated ? '世界已生成' : '世界未生成' }}
                  </NTag>
                </div>
                <div class="importer-candidate-row">
                  <span class="importer-label">分片</span>
                  <span>{{ selectedCandidate.shards.map(shardLabel).join('、') || '无' }}</span>
                  <span class="importer-label">存档大小</span>
                  <span>
                    {{ formatSize(selectedCandidate.sizeBytes) }}{{ selectedCandidate.sizeIncomplete ? '（超大档，仅部分统计）' : '' }}
                  </span>
                </div>
                <div class="importer-candidate-row">
                  <span class="importer-label">Mod</span>
                  <span>{{ selectedCandidate.modCount }} 个</span>
                  <span class="importer-label">令牌</span>
                  <span>{{ selectedCandidate.hasTokenFile ? '源档自带' : '源档未带' }}</span>
                </div>
                <div v-if="selectedCandidate.warnings.length > 0" class="importer-warns">
                  <div v-for="warning in selectedCandidate.warnings" :key="warning" class="importer-warn">
                    ⚠ {{ warning }}
                  </div>
                </div>
              </div>
            </template>
          </div>
        </NSpin>

        <div class="importer-field">
          <div class="importer-label">
            Klei 集群令牌（可选）
          </div>
          <NInput
            v-model:value="clusterToken"
            size="small"
            placeholder="留空则沿用实例已有令牌；公网模式需要 pds- 前缀令牌"
            maxlength="512"
          />
        </div>
      </template>

      <template v-else>
        <NAlert type="success" :show-icon="false">
          存档导入完成，可启动实例验证世界进度。
        </NAlert>
        <div class="importer-result">
          <div class="importer-candidate-row">
            <span class="importer-label">导入分片</span>
            <span>{{ importResult.importedShards.map(shardLabel).join('、') || '无' }}</span>
          </div>
          <div class="importer-candidate-row">
            <span class="importer-label">Mod</span>
            <span>{{ importResult.modCount }} 个已写入面板</span>
          </div>
          <div class="importer-candidate-row">
            <span class="importer-label">令牌</span>
            <span>{{ tokenSourceLabels[importResult.tokenSource] }}</span>
          </div>
          <div class="importer-candidate-row">
            <span class="importer-label">安全备份</span>
            <span>{{ importResult.safetyBackupId ? '已创建（导入前自动备份，可在列表恢复）' : '实例原本无存档，未创建' }}</span>
          </div>
          <div v-if="importResult.gamePortSynced" class="importer-candidate-row">
            <span class="importer-label">端口</span>
            <span>已按本机实例配置重写，面板记录已同步</span>
          </div>
          <div v-if="importResult.missingWorkshopContent.length > 0" class="importer-warn">
            ⚠ 以下 Mod 的创意工坊内容尚未下载：{{ importResult.missingWorkshopContent.join('、') }}。首次启动由游戏自动拉取（可能较慢），也可到 Mod 页面手动下载。
          </div>
          <div v-for="warning in importResult.warnings" :key="warning" class="importer-warn">
            ⚠ {{ warning }}
          </div>
          <div class="importer-warn">
            ⚠ 建议到「房间设置」核对导入的房间信息并重新保存一次，让面板状态与源档完全对齐。
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="importer-footer">
        <NButton size="small" @click="emit('update:show', false)">
          {{ importResult ? '关闭' : '取消' }}
        </NButton>
        <NButton
          v-if="!importResult"
          size="small"
          type="warning"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="confirmImport"
        >
          导入并覆盖实例存档
        </NButton>
      </div>
    </template>

    <DirectoryPathPicker
      v-model:show="pickerVisible"
      title="选择源存档目录"
      @select="(path: string) => { sourcePath = path; doProbe() }"
    />
  </NModal>
</template>

<style scoped>
.importer {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.importer-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.importer-label {
  font-size: 12px;
  color: #909090;
  flex-shrink: 0;
}

.importer-path-row {
  display: flex;
  gap: 8px;
}

.importer-hint {
  font-size: 12px;
  color: #b8b8c0;
}

.importer-candidate {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--custom-border-color, #efeff5);
  border-radius: 6px;
}

.importer-candidate-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}

.importer-warns {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.importer-warn {
  font-size: 12px;
  color: #d48806;
}

.importer-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.importer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
