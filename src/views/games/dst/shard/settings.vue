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
  NTooltip,
  useDialog,
  useMessage,
} from 'naive-ui'
import { computed, h, onActivated, onMounted, reactive, ref, watch } from 'vue'
import apiInstance from '@/api/modules/instance'
import apiShard from '@/api/modules/shard'
import { useHostMemoryGuidance } from '@/composables/useHostMemoryGuidance'
import { useNarrowFormLayout } from '@/composables/useNarrowFormLayout'
import {
  routeToDstRoomSettings,
  routeToDstWorldList,
} from '@/navigation/game-routes'
import { isInstanceInstallingStatus } from '@/views/node/instance/instanceDisplay'
import {
  formatPortConflictDetail,
  getPortConflictDialogLabels,
  isInstancePortConflictError,
} from '@/utils/instancePortConflict'
import ShardNetworkSection from './components/ShardNetworkSection.vue'
import ShardWorldRulesSection from './components/ShardWorldRulesSection.vue'
import ShardWorldgenSection from './components/ShardWorldgenSection.vue'
import {
  applyLeveldataOverridesFromServer,
  buildLeveldataOverridesPayload,
} from './utils/leveldataOverrides'

type ShardSubTab = 'rules' | 'worldgen' | 'network'

defineOptions({
  name: 'DstWorldSettings',
})

const route = useRoute()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()

const { formLabelPlacement, formLabelWidth } = useNarrowFormLayout(140)
const { guidance: hostMemoryGuidance } = useHostMemoryGuidance()

const instanceId = computed(() => String(route.params.instanceId ?? ''))
const loading = ref(false)
const savingMaster = ref(false)
const savingMasterRestart = ref(false)
const savingCaves = ref(false)
const savingCavesRestart = ref(false)
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

const clusterShardEnabled = computed(() => Boolean(shardList.value?.clusterShardEnabled))
const masterShard = computed(() => shardList.value?.shards.find(s => s.id === 'master'))
const cavesShard = computed(() => shardList.value?.shards.find(s => s.id === 'caves'))

const configAlerts = computed(() => {
  const list = shardList.value
  if (!list) {
    return { warnings: [] as string[], hints: [] as string[] }
  }
  const hints = [...list.effectiveHints]
  const anyDirty = list.shards.some(s => s.configDirty)
  if (anyDirty && !hints.some(h => h.includes('重启'))) {
    hints.unshift('实例运行中，配置变更需重启实例后生效')
  }
  return {
    warnings: list.warnings,
    hints,
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

function containerStatusTag(shard: ShardSummaryDto | undefined) {
  if (!shard) {
    return '未知'
  }
  const map = {
    running: '运行中',
    stopped: '已停止',
    not_created: '未创建',
    unknown: '未知',
  } as const
  return map[shard.containerStatus]
}

function resetLocalWorldRules() {
  masterWorldRules.value = {}
  cavesWorldRules.value = {}
  masterWorldgenConfig.value = {}
  cavesWorldgenConfig.value = {}
}

function applyShardToForm(shard: ShardSummaryDto) {
  if (shard.id === 'master') {
    applyLeveldataOverridesFromServer(masterWorldRules.value, 'rules', 'master', shard.leveldataOverrides)
    applyLeveldataOverridesFromServer(masterWorldgenConfig.value, 'worldgen', 'master', shard.leveldataOverrides)
  }
  else {
    applyLeveldataOverridesFromServer(cavesWorldRules.value, 'rules', 'caves', shard.leveldataOverrides)
    applyLeveldataOverridesFromServer(cavesWorldgenConfig.value, 'worldgen', 'caves', shard.leveldataOverrides)
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
    worldRuleOverrides: buildLeveldataOverridesPayload(shard, 'rules', worldRules),
    restart,
  }
  if (!summary?.worldGenerated) {
    payload.worldgenOverrides = buildLeveldataOverridesPayload(shard, 'worldgen', worldgenConfig)
  }
  return payload
}

function shardSavingFlags(shard: ShardId, restart: boolean) {
  if (shard === 'master') {
    return restart ? savingMasterRestart : savingMaster
  }
  return restart ? savingCavesRestart : savingCaves
}

async function saveShard(shard: ShardId, restart: boolean) {
  const formRef = shard === 'master' ? masterFormRef.value : cavesFormRef.value
  try {
    await formRef?.validate()
  }
  catch {
    return
  }
  const savingFlag = shardSavingFlags(shard, restart)
  savingFlag.value = true
  try {
    await apiShard.saveShardConfig(buildSavePayload(shard, restart))
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
          mainTab.value = 'surface'
          surfaceSubTab.value = 'network'
        },
      })
      return
    }
    const msg = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error && 'error' in error ? String((error as { error?: string }).error) : '保存失败')
    message.error(msg)
  }
  finally {
    savingFlag.value = false
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
  if (!instanceId.value) {
    return
  }
  allocatingPorts.value = true
  try {
    const { data } = await apiInstance.allocateInstancePorts(instanceId.value)
    message.success(`已自动分配端口，主世界游戏端口为 ${data.gamePort}`)
    await loadConfig()
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

    <NSpin :show="loading">
      <NEmpty
        v-if="!loading && !shardList"
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

      <div v-else-if="shardList" class="space-y-4">
        <NAlert
          v-for="(w, i) in configAlerts.warnings"
          :key="`w-${i}`"
          type="warning"
          :title="w"
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
                <NTag size="tiny" :bordered="false">
                  {{ containerStatusTag(masterShard) }}
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

            <div class="flex flex-wrap justify-center gap-2 mt-4 pt-4 border-t border-border">
              <NButton type="primary" size="small" :loading="savingMaster" @click="saveShard('master', false)">
                保存地上
              </NButton>
              <NTooltip :disabled="!saveAndRestartDisabled">
                <template #trigger>
                  <NButton
                    size="small"
                    :loading="savingMasterRestart"
                    :disabled="saveAndRestartDisabled"
                    @click="confirmSaveAndRestart('master')"
                  >
                    保存并重启
                  </NButton>
                </template>
                {{ saveAndRestartDisabledTitle }}
              </NTooltip>
            </div>
          </NTabPane>

          <NTabPane name="caves">
            <template #tab>
              <span class="inline-flex items-center gap-2">
                洞穴
                <NTag
                  v-if="clusterShardEnabled"
                  size="tiny"
                  :bordered="false"
                >
                  {{ containerStatusTag(cavesShard) }}
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

              <div class="flex flex-wrap justify-center gap-2 mt-4 pt-4 border-t border-border">
                <NButton type="primary" size="small" :loading="savingCaves" @click="saveShard('caves', false)">
                  保存洞穴
                </NButton>
                <NTooltip :disabled="!saveAndRestartDisabled">
                  <template #trigger>
                    <NButton
                      size="small"
                      :loading="savingCavesRestart"
                      :disabled="saveAndRestartDisabled"
                      @click="confirmSaveAndRestart('caves')"
                    >
                      保存并重启
                    </NButton>
                  </template>
                  {{ saveAndRestartDisabledTitle }}
                </NTooltip>
              </div>
            </template>
          </NTabPane>

          <NTabPane name="mods" tab="模组">
            <AppHostMemoryAlert
              v-if="hostMemoryGuidance?.modsWarning"
              title="内存与模组"
              :message="hostMemoryGuidance.modsWarning"
            />
            <NAlert type="info" class="mt-2" title="模组配置（规划中）">
              <p class="text-sm">
                v1 世界设置页暂不编辑模组。模组管理将在后续版本提供；当前请通过 Klei 官方工具或手动维护。
              </p>
            </NAlert>
          </NTabPane>
        </NTabs>
      </div>
    </NSpin>
  </FaPageMain>
</template>
