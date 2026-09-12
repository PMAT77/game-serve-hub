<script setup lang="ts">
import type { FormInst, FormRules } from 'naive-ui'
import type {
  CavesWorldgenPreset,
  ShardId,
  ShardListDto,
  ShardSavePayload,
  ShardSummaryDto,
} from '@/api/modules/shard'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  useDialog,
  useMessage,
  useNotification,
} from 'naive-ui'
import { computed, h, onActivated, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import apiInstance from '@/api/modules/instance'
import apiShard from '@/api/modules/shard'
import { useHostMemoryGuidance } from '@/composables/useHostMemoryGuidance'
import { useNarrowFormLayout } from '@/composables/useNarrowFormLayout'
import { useUnsavedChangesGuard } from '@/composables/useUnsavedChangesGuard'
import ConfigActionBar from '@/components/ConfigActionBar.vue'
import {
  routeToDstRoomSettings,
  routeToDstWorldList,
} from '@/navigation/game-routes'
import { isInstanceInstallingStatus } from '@/views/node/instance/instanceDisplay'
import { resolveShardDisplayStatus, statusTagType } from '@/constants/statusDictionary'
import { tryNotifyHostMemoryPressure } from '@/utils/hostMemoryPressure'
import { shardSavePayloadSchema } from '@/api/modules/shard'
import {
  formatPortConflictDetail,
  getPortConflictDialogLabels,
  isInstancePortConflictError,
} from '@/utils/instancePortConflict'
import ShardNetworkSection from './components/ShardNetworkSection.vue'
import ShardModsSection from './components/ShardModsSection.vue'
import ShardWorldRulesSection from './components/ShardWorldRulesSection.vue'
import AdminSettingsSection from '@/components/AdminSettingsSection.vue'
import ShardWorldgenSection from './components/ShardWorldgenSection.vue'
import {
  applyLeveldataOverridesFromServer,
  buildLeveldataOverridesPayload,
} from './utils/leveldataOverrides'

type ShardSubTab = 'rules' | 'worldgen' | 'network'
type ShardSaveOperation = `${ShardId}:${'save' | 'restart'}`

defineOptions({
  name: 'DstWorldSettings',
})

const route = useRoute()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const notification = useNotification()

const { formLabelPlacement, formLabelWidth } = useNarrowFormLayout(140)
const { guidance: hostMemoryGuidance } = useHostMemoryGuidance()

const instanceId = computed(() => String(route.params.instanceId ?? ''))
const loading = ref(false)
const activeSaveOperation = shallowRef<ShardSaveOperation | null>(null)
const isSaving = computed(() => activeSaveOperation.value !== null)
const shardList = ref<ShardListDto | null>(null)

const saveAndRestartDisabled = computed(() =>
  isInstanceInstallingStatus(shardList.value?.instanceStatus),
)

const saveAndRestartDisabledTitle = computed(() =>
  saveAndRestartDisabled.value ? '实例安装完成后才可保存并重启' : undefined,
)

const mainTab = ref<'surface' | 'caves' | 'mods'>('surface')
const surfaceSubTab = ref<ShardSubTab>('rules')
const cavesSubTab = ref<ShardSubTab>('rules')
const allocatingPorts = ref(false)

const masterWorldRules = ref<Record<string, string>>({})
const cavesWorldRules = ref<Record<string, string>>({})
const masterWorldgenConfig = ref<Record<string, string>>({})
const cavesWorldgenConfig = ref<Record<string, string>>({})

/** 服务端当前已保存的世界规则快照，用于保存时做差异提交（未修改项不下发） */
const persistedMasterOverrides = ref<Record<string, string>>({})
const persistedCavesOverrides = ref<Record<string, string>>({})

const masterFormRef = ref<FormInst | null>(null)
const cavesFormRef = ref<FormInst | null>(null)

const masterForm = reactive({
  serverPort: 10999,
  steamAuthPort: 8766,
  steamMasterPort: 12346,
  worldgenPreset: 'SURVIVAL_TOGETHER' as const,
})

const cavesForm = reactive({
  serverPort: 11000,
  steamAuthPort: 8768,
  steamMasterPort: 12348,
  worldgenPreset: 'DST_CAVE' as CavesWorldgenPreset,
})

const pageTitle = computed(() => shardList.value
  ? `世界设置 · ${shardList.value.instanceName}`
  : '世界设置')

/** 远端快照：加载/保存成功后更新，用于脏状态判定与一键重置 */
const savedSnapshot = ref('')

function buildFormSnapshot(): string {
  return JSON.stringify({
    masterForm: { ...masterForm },
    cavesForm: { ...cavesForm },
    masterWorldRules: masterWorldRules.value,
    cavesWorldRules: cavesWorldRules.value,
    masterWorldgenConfig: masterWorldgenConfig.value,
    cavesWorldgenConfig: cavesWorldgenConfig.value,
  })
}

const formDirty = computed(() => savedSnapshot.value !== '' && buildFormSnapshot() !== savedSnapshot.value)

useUnsavedChangesGuard(formDirty)

/** 底部保存栏作用于当前激活的分片（模组页签不保存） */
const currentShardId = computed<ShardId>(() => (mainTab.value === 'caves' ? 'caves' : 'master'))

const clusterShardEnabled = computed(() => Boolean(shardList.value?.clusterShardEnabled))
const masterShard = computed(() => shardList.value?.shards.find(s => s.id === 'master'))
const cavesShard = computed(() => shardList.value?.shards.find(s => s.id === 'caves'))

/**
 * 顶部只承载「现在需要处理」的信息：异常警告，以及实例运行中这条会影响保存行为的条件提示。
 * 静态说明（世界已生成、放行端口、洞穴未开启）一律内联到对应页签与控件旁，避免同一信息重复出现。
 */
const configAlerts = computed(() => {
  const list = shardList.value
  if (!list) {
    return { warnings: [] as string[], hints: [] as string[] }
  }
  const running = list.shards.some(s => s.configDirty)
  return {
    warnings: list.warnings,
    hints: running ? ['实例运行中，配置变更需重启实例后生效'] : [],
  }
})

const portRules: FormRules = {
  serverPort: [
    { type: 'number', required: true, min: 1, max: 65535, message: '端口须在 1–65535', trigger: ['blur', 'change'] },
  ],
  steamAuthPort: [
    { type: 'number', required: true, min: 1, max: 65535, message: '端口须在 1–65535', trigger: ['blur', 'change'] },
  ],
  steamMasterPort: [
    { type: 'number', required: true, min: 1, max: 65535, message: '端口须在 1–65535', trigger: ['blur', 'change'] },
  ],
}

/** 分片状态标签：容器不存在不等于「没配置/没存档」，一律走全站状态词典 */
const masterShardStatus = computed(() => resolveShardDisplayStatus(masterShard.value))
const cavesShardStatus = computed(() => resolveShardDisplayStatus(cavesShard.value))

function resetLocalWorldRules() {
  masterWorldRules.value = {}
  cavesWorldRules.value = {}
  masterWorldgenConfig.value = {}
  cavesWorldgenConfig.value = {}
  persistedMasterOverrides.value = {}
  persistedCavesOverrides.value = {}
}

function applyShardToForm(shard: ShardSummaryDto) {
  const persisted = { ...shard.overrides }
  if (shard.id === 'master') {
    persistedMasterOverrides.value = persisted
    applyLeveldataOverridesFromServer(masterWorldRules.value, 'rules', 'master', shard.overrides)
    applyLeveldataOverridesFromServer(masterWorldgenConfig.value, 'worldgen', 'master', shard.overrides)
  }
  else {
    persistedCavesOverrides.value = persisted
    applyLeveldataOverridesFromServer(cavesWorldRules.value, 'rules', 'caves', shard.overrides)
    applyLeveldataOverridesFromServer(cavesWorldgenConfig.value, 'worldgen', 'caves', shard.overrides)
  }
  if (shard.serverPort != null) {
    if (shard.id === 'master') {
      masterForm.serverPort = shard.serverPort
      masterForm.steamAuthPort = shard.steamAuthPort ?? 8766
      masterForm.steamMasterPort = shard.steamMasterPort ?? 12346
      if (shard.worldgenPreset === 'SURVIVAL_TOGETHER') {
        masterForm.worldgenPreset = shard.worldgenPreset
      }
    }
    else {
      cavesForm.serverPort = shard.serverPort
      cavesForm.steamAuthPort = shard.steamAuthPort ?? 8768
      cavesForm.steamMasterPort = shard.steamMasterPort ?? 12348
      if (shard.worldgenPreset && shard.worldgenPreset !== 'SURVIVAL_TOGETHER') {
        cavesForm.worldgenPreset = shard.worldgenPreset as CavesWorldgenPreset
      }
    }
  }
}

async function loadConfig() {
  if (!instanceId.value) {
    return
  }
  loading.value = true
  try {
    resetLocalWorldRules()
    const response = await apiShard.getShardList(instanceId.value)
    shardList.value = response.data
    for (const shard of response.data.shards) {
      applyShardToForm(shard)
    }
    savedSnapshot.value = buildFormSnapshot()
  }
  catch {
    message.error('加载世界配置失败，请确认实例已安装且后端服务正常')
    shardList.value = null
  }
  finally {
    loading.value = false
  }
}

function buildSavePayload(shard: ShardId, restart: boolean): ShardSavePayload {
  const form = shard === 'master' ? masterForm : cavesForm
  const worldRules = shard === 'master' ? masterWorldRules.value : cavesWorldRules.value
  const worldgenConfig = shard === 'master' ? masterWorldgenConfig.value : cavesWorldgenConfig.value
  const summary = shard === 'master' ? masterShard.value : cavesShard.value
  const payload: ShardSavePayload = {
    instanceId: instanceId.value,
    shard,
    serverPort: form.serverPort,
    steamAuthPort: form.steamAuthPort,
    steamMasterPort: form.steamMasterPort,
    worldgenPreset: form.worldgenPreset,
    worldRuleOverrides: buildLeveldataOverridesPayload(
      shard,
      'rules',
      worldRules,
      shard === 'master' ? persistedMasterOverrides.value : persistedCavesOverrides.value,
    ),
    restart,
  }
  if (!summary?.worldGenerated) {
    payload.worldgenOverrides = buildLeveldataOverridesPayload(
      shard,
      'worldgen',
      worldgenConfig,
      shard === 'master' ? persistedMasterOverrides.value : persistedCavesOverrides.value,
    )
  }
  return payload
}

/** 保存前客户端预校验：把 zod 问题翻译成可定位的提示，避免后端原始报错直出 */
function describePayloadIssues(payload: ShardSavePayload): string | null {
  const parsed = shardSavePayloadSchema.safeParse(payload)
  if (parsed.success) {
    return null
  }
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(p => String(p)).join('.')
    if (path.startsWith('worldRuleOverrides.') || path.startsWith('worldgenOverrides.')) {
      const key = String(issue.path[1] ?? '')
      return `世界规则项 ${key} 的值无效，请检查世界规则设置`
    }
    if (path === 'worldgenPreset') {
      return issue.message
    }
    if (path.endsWith('Port')) {
      return '端口须为 1–65535 的整数，请检查网络设置'
    }
    return issue.message
  }
  return '保存失败，请检查填写内容'
}

function getSaveOperation(shard: ShardId, restart: boolean): ShardSaveOperation {
  return `${shard}:${restart ? 'restart' : 'save'}`
}

async function saveShard(shard: ShardId, restart: boolean) {
  if (isSaving.value || allocatingPorts.value) {
    return
  }
  const formRef = shard === 'master' ? masterFormRef.value : cavesFormRef.value
  try {
    await formRef?.validate()
  }
  catch {
    return
  }
  if (shard === 'caves' && cavesForm.serverPort === masterForm.serverPort) {
    message.error('洞穴游戏端口不能与地上世界相同，请在「网络」页签中修改后保存')
    return
  }
  const payload = buildSavePayload(shard, restart)
  const payloadIssue = describePayloadIssues(payload)
  if (payloadIssue) {
    message.error(payloadIssue)
    return
  }
  const operation = getSaveOperation(shard, restart)
  activeSaveOperation.value = operation
  try {
    await apiShard.saveShardConfig(payload)
    message.success(restart ? '世界配置已保存并触发重启' : '世界配置已保存')
    await loadConfig()
  }
  catch (error: unknown) {
    if (restart && isInstancePortConflictError(error)) {
      const labels = getPortConflictDialogLabels('restart')
      dialog.warning({
        title: labels.title,
        content: () => h('div', { class: 'space-y-2 text-sm' }, [
          h('p', '世界配置已保存，但因端口冲突未能重启实例。'),
          h('p', error.error),
          h('p', { class: 'text-muted-foreground' }, formatPortConflictDetail(error.data ?? {})),
        ]),
        positiveText: labels.positiveText,
        negativeText: '留在本页修改端口',
        onPositiveClick: async () => {
          try {
            await apiInstance.restartInstance(instanceId.value, { autoAllocatePorts: true })
            message.success('已自动分配端口并完成重启')
            await loadConfig()
          }
          catch (retryError: unknown) {
            const description = retryError instanceof Error
              ? retryError.message
              : (typeof retryError === 'object' && retryError && 'error' in retryError
                ? String((retryError as { error?: string }).error)
                : '请稍后重试')
            message.error(description || '重启失败')
          }
        },
        onNegativeClick: () => {
          mainTab.value = shard === 'caves' ? 'caves' : 'surface'
          if (shard === 'caves') {
            cavesSubTab.value = 'network'
          }
          else {
            surfaceSubTab.value = 'network'
          }
        },
      })
      return
    }
    if (tryNotifyHostMemoryPressure(notification, error)) {
      return
    }
    const msg = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error && 'error' in error ? String((error as { error?: string }).error) : '保存失败')
    message.error(msg)
  }
  finally {
    if (activeSaveOperation.value === operation) {
      activeSaveOperation.value = null
    }
  }
}

function confirmSaveAndRestart(shard: ShardId) {
  dialog.warning({
    title: '保存并重启',
    content: '将保存当前世界配置并重启实例，在线玩家会被断开。是否继续？',
    positiveText: '继续',
    negativeText: '取消',
    onPositiveClick: () => saveShard(shard, true),
  })
}

function goClusterSettings() {
  router.push(routeToDstRoomSettings(instanceId.value))
}

function goBack() {
  router.push(routeToDstWorldList())
}

function applyRouteTabFromQuery() {
  if (route.query.tab === 'network') {
    mainTab.value = 'surface'
    surfaceSubTab.value = 'network'
  }
}

async function autoAllocatePorts() {
  if (!instanceId.value || allocatingPorts.value || isSaving.value) {
    return
  }
  allocatingPorts.value = true
  try {
    const { data } = await apiInstance.allocateInstancePorts(instanceId.value)
    const offset = data.gamePort - 10999
    masterForm.serverPort = data.gamePort
    masterForm.steamAuthPort = 8766 + offset
    masterForm.steamMasterPort = 12346 + offset
    if (cavesShard.value?.configured) {
      cavesForm.serverPort = masterForm.serverPort + 1
      cavesForm.steamAuthPort = masterForm.steamAuthPort + 2
      cavesForm.steamMasterPort = masterForm.steamMasterPort + 2
    }
    message.success(`已自动分配端口，主世界游戏端口为 ${data.gamePort}`)
  }
  catch (error) {
    const description = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error && 'error' in error ? String((error as { error?: string }).error) : '请稍后重试')
    message.error(description || '自动分配端口失败')
  }
  finally {
    allocatingPorts.value = false
  }
}

watch(instanceId, (id) => {
  if (id) {
    void loadConfig()
  }
}, { immediate: true })

watch(() => route.query.tab, () => {
  applyRouteTabFromQuery()
}, { immediate: true })

onMounted(() => {
  applyRouteTabFromQuery()
})

onActivated(() => {
  applyRouteTabFromQuery()
  if (instanceId.value) {
    void loadConfig()
  }
})
</script>

<template>
  <FaPageMain>
    <template #title>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h1 class="text-lg font-semibold">
          {{ pageTitle }}
        </h1>

        <FaButton variant="outline" size="sm" @click="goBack">
          返回世界列表
        </FaButton>
      </div>
    </template>

    <NSpin v-if="loading && !shardList" size="large" class="block mx-auto my-8" />
    <template v-else>
      <NEmpty
        v-if="!shardList"
        class="py-16"
        description="未能加载世界配置。请确认实例已安装、路由带有实例 ID，且后端服务可用。"
      >
        <template #extra>
          <NButton size="small" @click="goBack">
            返回世界列表
          </NButton>
          <NButton v-if="instanceId" size="small" class="ml-2" @click="loadConfig">
            重试
          </NButton>
        </template>
      </NEmpty>

      <div v-else class="space-y-4">
        <AdminSettingsSection
          title="世界配置"
          description="分别调整地上与洞穴的地图规则、端口与 Mod。保存后写入分片配置。"
        />
        <NAlert v-if="configAlerts.warnings.length" type="warning" title="需要处理" class="mb-2">
          <ul class="list-disc pl-4 space-y-1">
            <li v-for="(w, i) in configAlerts.warnings" :key="`w-${i}`">
              {{ w }}
            </li>
          </ul>
        </NAlert>
        <NAlert
          v-for="(hint, i) in configAlerts.hints"
          :key="`h-${i}`"
          type="info"
          :title="hint"
          class="mb-2"
        />

        <NCard size="small" title="洞穴开关">
          <p class="text-sm text-muted-foreground mb-2">
            是否在房间中同时运行地上与洞穴，请在房间设置中配置。
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <NTag :type="shardList.clusterShardEnabled ? 'info' : 'default'" size="small" :bordered="false">
              {{ shardList.clusterShardEnabled ? '洞穴已开启' : '洞穴未开启' }}
            </NTag>
            <NButton size="small" text @click="goClusterSettings">
              前往房间设置
              <FaIcon name="i-lucide:arrow-right" class="size-4" />
            </NButton>
          </div>
        </NCard>

        <NTabs v-model:value="mainTab" type="card" animated>
          <NTabPane name="surface">
            <template #tab>
              <span class="inline-flex items-center gap-2">
                地上
                <NTag size="tiny" :bordered="false" :type="statusTagType(masterShardStatus.tone)">
                  {{ masterShardStatus.label }}
                </NTag>
              </span>
            </template>

            <NForm
              ref="masterFormRef"
              :model="masterForm"
              :rules="portRules"
              :label-placement="formLabelPlacement"
              :label-width="formLabelWidth"
            >
              <NTabs v-model:value="surfaceSubTab" type="card" placement="left" size="small" display-directive="show" class="mt-2">
                <NTabPane name="rules" tab="世界规则">
                  <p v-if="masterShard?.worldGenerated" class="mt-2 mb-4 text-xs text-muted-foreground">
                    地上世界已生成：世界规则的改动会在该分片重新生成地图时生效，不会改变现有存档。
                  </p>
                  <ShardWorldRulesSection
                    v-model="masterWorldRules"
                    shard="master"
                    shard-folder="Master"
                  />
                </NTabPane>

                <NTabPane name="worldgen" tab="世界生成">
                  <ShardWorldgenSection
                    v-model="masterForm.worldgenPreset"
                    v-model:worldgen-config="masterWorldgenConfig"
                    shard="master"
                    shard-folder="Master"
                    :world-generated="masterShard?.worldGenerated"
                  />
                </NTabPane>

                <NTabPane name="network" tab="网络">
                  <div class="flex flex-wrap items-center gap-2 mb-4">
                    <NButton
                      size="small"
                      :loading="allocatingPorts"
                      :disabled="isSaving"
                      @click="autoAllocatePorts"
                    >
                      自动分配未占用端口
                    </NButton>
                    <span class="text-xs text-muted-foreground">
                      与同节点其它实例冲突时可一键换用新端口块；保存后生效，运行中需重启。
                    </span>
                  </div>
                  <ShardNetworkSection
                    v-model:server-port="masterForm.serverPort"
                    v-model:steam-auth-port="masterForm.steamAuthPort"
                    v-model:steam-master-port="masterForm.steamMasterPort"
                    shard-folder="Master"
                  />
                </NTabPane>
              </NTabs>
            </NForm>

          </NTabPane>

          <NTabPane name="caves">
            <template #tab>
              <span class="inline-flex items-center gap-2">
                洞穴
                <NTag
                  v-if="clusterShardEnabled"
                  size="tiny"
                  :bordered="false"
                  :type="statusTagType(cavesShardStatus.tone)"
                >
                  {{ cavesShardStatus.label }}
                </NTag>
                <NTag v-else size="tiny" :bordered="false" type="default">
                  未开启
                </NTag>
              </span>
            </template>

            <template v-if="!clusterShardEnabled">
              <p class="text-sm text-muted-foreground mt-2 mb-4">
                洞穴未开启。请先在房间设置中打开「启用洞穴」并保存；保存后将自动生成洞穴默认配置，再在此调整世界规则与世界生成。
              </p>
              <NButton size="small" @click="goClusterSettings">
                前往房间设置
              </NButton>
            </template>

            <template v-else>
              <NForm
                ref="cavesFormRef"
                :model="cavesForm"
                :rules="portRules"
                :label-placement="formLabelPlacement"
                :label-width="formLabelWidth"
              >
                <NTabs v-model:value="cavesSubTab" type="card" placement="left" size="small" display-directive="show" class="mt-2">
                  <NTabPane name="rules" tab="世界规则">
                    <p v-if="cavesShard?.worldGenerated" class="mt-2 mb-4 text-xs text-muted-foreground">
                      洞穴世界已生成：世界规则的改动会在该分片重新生成地图时生效，不会改变现有存档。
                    </p>
                    <ShardWorldRulesSection
                      v-model="cavesWorldRules"
                      shard="caves"
                      shard-folder="Caves"
                    />
                  </NTabPane>

                  <NTabPane name="worldgen" tab="世界生成">
                    <ShardWorldgenSection
                      v-model="cavesForm.worldgenPreset"
                      v-model:worldgen-config="cavesWorldgenConfig"
                      shard="caves"
                      shard-folder="Caves"
                      :world-generated="cavesShard?.worldGenerated"
                    />
                  </NTabPane>

                  <NTabPane name="network" tab="网络">
                    <ShardNetworkSection
                      v-model:server-port="cavesForm.serverPort"
                      v-model:steam-auth-port="cavesForm.steamAuthPort"
                      v-model:steam-master-port="cavesForm.steamMasterPort"
                      shard-folder="Caves"
                      show-port-hint
                    />
                  </NTabPane>
                </NTabs>
              </NForm>

            </template>
          </NTabPane>

          <NTabPane name="mods" tab="模组">
            <ShardModsSection
              :instance-id="instanceId"
              :memory-warning="hostMemoryGuidance?.modsWarning ?? null"
            />
          </NTabPane>
        </NTabs>

        <ConfigActionBar
          :dirty="formDirty"
          :saving="isSaving"
          :restart-disabled="saveAndRestartDisabled"
          :restart-disabled-title="saveAndRestartDisabledTitle"
          :save-label="mainTab === 'caves' ? '保存洞穴' : '保存地上'"
          @reset="loadConfig"
          @save="saveShard(currentShardId, false)"
          @save-and-restart="confirmSaveAndRestart(currentShardId)"
        />
      </div>
    </template>
  </FaPageMain>
</template>
