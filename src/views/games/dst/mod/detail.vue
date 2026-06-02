<script setup lang="ts">
import type { SteamModDetailDto } from '@/api/modules/mod'
import dayjs from 'dayjs'
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NImage,
  NScrollbar,
  NSpin,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { resolveModLocalizedText } from '../../../../../shared/contracts/mod'
import apiMod from '@/api/modules/mod'
import { useInstanceModState } from '@/composables/useInstanceModState'
import { useModContentLocale } from '@/composables/useModContentLocale'
import { routeToDstModList, routeToDstWorldSettings } from '@/navigation/game-routes'

defineOptions({
  name: 'DstModDetail',
})

interface BusinessErrorLike {
  error?: string
  code?: string
}

const route = useRoute()
const router = useRouter()
const message = useMessage()
const { locale: contentLocale } = useModContentLocale()

const loading = ref(false)
const detail = ref<SteamModDetailDto | null>(null)

const workshopId = computed(() => String(route.params.workshopId ?? '').trim())
const instanceId = computed(() => {
  const queryValue = route.query.instanceId
  return typeof queryValue === 'string' ? queryValue.trim() : ''
})

const {
  isPendingWorkshop,
  resolveSubscribeButtonText,
  restoreInstallJobs,
  installMod,
  resetState,
} = useInstanceModState(() => instanceId.value)

const isDownloading = computed(() => isPendingWorkshop(workshopId.value))

const displayTitle = computed(() => {
  if (!detail.value) {
    return 'Mod 详情'
  }
  const resolved = resolveModLocalizedText(detail.value.titles, contentLocale.value)
  return resolved.value || detail.value.title
})

const displayDescription = computed(() => {
  if (!detail.value) {
    return ''
  }
  const resolved = resolveModLocalizedText(detail.value.descriptions, contentLocale.value)
  return resolved.value || detail.value.description
})

const installButtonText = computed(() => {
  if (!detail.value || detail.value.installed) {
    return '已订阅'
  }
  return resolveSubscribeButtonText(workshopId.value, false)
})

const installButtonDisabled = computed(() =>
  !detail.value
  || !instanceId.value
  || detail.value.installed
  || isDownloading.value,
)

const installButtonLoading = computed(() => isDownloading.value && !detail.value?.installed)

function formatDateTime(value: string | null): string {
  if (!value) {
    return '-'
  }
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) {
    return '-'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'object' && error && 'error' in error) {
    const apiError = error as BusinessErrorLike
    if (apiError.error) {
      return apiError.error
    }
  }
  return fallback
}

function isAuthUnauthorizedError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as BusinessErrorLike).code === 'AUTH_UNAUTHORIZED'
}

function goToWorldSettings() {
  if (!instanceId.value) {
    return
  }
  router.push(routeToDstWorldSettings(instanceId.value))
}

function showSubscribeSuccessGuide() {
  message.success('订阅成功。请到世界设置开启 Mod，并在实例控制台重启实例后生效。', {
    duration: 6000,
  })
}

async function handleInstallJobTerminal(job: Awaited<ReturnType<typeof apiMod.pollModInstallJob>>) {
  if (job.status === 'success' && detail.value) {
    detail.value = { ...detail.value, installed: true }
    showSubscribeSuccessGuide()
    return
  }
  if (job.status === 'failed') {
    message.error(job.error || '订阅失败，请稍后重试')
  }
}

async function loadDetail() {
  if (!workshopId.value) {
    detail.value = null
    return
  }
  if (!instanceId.value) {
    detail.value = null
    return
  }
  loading.value = true
  try {
    const response = await apiMod.getSteamModDetail(instanceId.value, workshopId.value, {
      locale: contentLocale.value,
    })
    detail.value = response.data
  }
  catch (error: unknown) {
    detail.value = null
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '加载 Mod 详情失败'))
  }
  finally {
    loading.value = false
  }
}

async function installModAction() {
  if (!detail.value || !instanceId.value || detail.value.installed || isDownloading.value) {
    return
  }
  try {
    await installMod({
      workshopId: detail.value.workshopId,
      name: detail.value.title,
      previewImage: detail.value.previewImage ?? undefined,
    }, {
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  catch (error: unknown) {
    if (isAuthUnauthorizedError(error)) {
      return
    }
    message.error(getErrorMessage(error, '订阅失败，请稍后重试'))
  }
}

function goBack() {
  router.push(routeToDstModList())
}

onMounted(async () => {
  if (instanceId.value) {
    await restoreInstallJobs({
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
  await loadDetail()
})

watch(instanceId, async (value, previousValue) => {
  if (value === previousValue) {
    return
  }
  resetState()
  if (value) {
    await restoreInstallJobs({
      onTerminal: job => void handleInstallJobTerminal(job),
    })
  }
})

watch(contentLocale, () => {
  if (!instanceId.value || !workshopId.value) {
    return
  }
  void loadDetail()
})
</script>

<template>
  <div class="dst-mod-detail-page absolute inset-0 flex flex-col overflow-hidden p-4">
    <FaPageMain
      class="flex min-h-0 flex-1 flex-col overflow-hidden !m-0 h-full"
      main-class="flex min-h-0 flex-1 flex-col"
    >
      <template #title>
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h1 class="text-lg font-semibold">
            {{ displayTitle }}
          </h1>
          <NButton quaternary @click="goBack">
            返回 Mod 列表
          </NButton>
        </div>
      </template>

      <NSpin
        :show="loading"
        class="dst-mod-detail-spin flex min-h-0 flex-1 flex-col"
        content-class="flex min-h-0 flex-1 flex-col"
      >
        <NEmpty
          v-if="!loading && !instanceId"
          class="py-16"
          description="缺少实例信息，请从 Mod 列表进入详情页。"
        >
          <template #extra>
            <NButton type="primary" @click="goBack">
              返回 Mod 列表
            </NButton>
          </template>
        </NEmpty>

        <NEmpty
          v-else-if="!loading && !detail"
          class="py-16"
          description="未能加载 Mod 详情，请稍后重试。"
        >
          <template #extra>
            <NButton @click="goBack">
              返回 Mod 列表
            </NButton>
            <NButton v-if="instanceId && workshopId" class="ml-2" @click="loadDetail">
              重试
            </NButton>
          </template>
        </NEmpty>

        <div v-else-if="detail" class="flex min-h-0 flex-1 flex-col gap-4">
          <NCard size="small" title="基本信息" class="shrink-0">
            <div class="flex flex-col gap-4 lg:flex-row">
              <div class="shrink-0">
                <NImage
                  v-if="detail.previewImage"
                  :src="detail.previewImage"
                  width="160"
                  height="160"
                  object-fit="cover"
                  lazy
                  class="rounded"
                />
                <div
                  v-else
                  class="flex size-40 items-center justify-center rounded bg-muted text-sm text-muted-foreground"
                >
                  无缩略图
                </div>
              </div>

              <NDescriptions
                :column="1"
                label-placement="left"
                class="min-w-0 flex-1"
              >
                <NDescriptionsItem label="Mod 名称">
                  {{ displayTitle }}
                </NDescriptionsItem>
                <NDescriptionsItem label="创作者">
                  {{ detail.creatorName ?? '-' }}
                </NDescriptionsItem>
                <NDescriptionsItem label="创意工坊 ID">
                  {{ detail.workshopId }}
                </NDescriptionsItem>
                <NDescriptionsItem label="文件大小">
                  {{ formatFileSize(detail.fileSize) }}
                </NDescriptionsItem>
                <NDescriptionsItem label="标签">
                  <div v-if="detail.tags.length > 0" class="flex flex-wrap gap-1">
                    <NTag
                      v-for="tag in detail.tags"
                      :key="tag"
                      size="small"
                      :bordered="false"
                    >
                      {{ tag }}
                    </NTag>
                  </div>
                  <span v-else class="text-muted-foreground">-</span>
                </NDescriptionsItem>
                <NDescriptionsItem label="发布时间">
                  {{ formatDateTime(detail.publishedAt) }}
                </NDescriptionsItem>
                <NDescriptionsItem label="更新时间">
                  {{ formatDateTime(detail.updatedAt) }}
                </NDescriptionsItem>
                <NDescriptionsItem label="订阅状态">
                  <NTag
                    size="small"
                    :bordered="false"
                    :type="detail.installed ? 'success' : 'default'"
                  >
                    {{ detail.installed ? '已订阅' : '未订阅' }}
                  </NTag>
                </NDescriptionsItem>
              </NDescriptions>
            </div>
          </NCard>

          <NCard
            size="small"
            title="描述"
            class="dst-mod-detail-desc-card flex min-h-0 flex-1 flex-col"
            content-class="flex min-h-0 flex-1 flex-col"
          >
            <NScrollbar class="min-h-0 flex-1">
              <p
                v-if="displayDescription"
                class="whitespace-pre-wrap pr-3 text-sm leading-relaxed"
              >
                {{ displayDescription }}
              </p>
              <p v-else class="text-sm text-muted-foreground">
                暂无描述
              </p>
            </NScrollbar>
          </NCard>

          <NAlert
            v-if="detail.installed"
            type="success"
            title="订阅成功后"
            class="shrink-0"
          >
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span>请到世界设置开启 Mod，并在实例控制台重启实例后生效。</span>
              <NButton size="tiny" type="primary" @click="goToWorldSettings">
                前往世界设置
              </NButton>
            </div>
          </NAlert>

          <div class="flex shrink-0 justify-center gap-2">
            <NButton
              type="primary"
              :disabled="installButtonDisabled"
              :loading="installButtonLoading"
              @click="installModAction"
            >
              {{ installButtonText }}
            </NButton>
            <NButton
              tag="a"
              :href="detail.detailUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              在 Steam 查看
            </NButton>
          </div>
        </div>
      </NSpin>
    </FaPageMain>
  </div>
</template>

<style scoped>
.dst-mod-detail-page :deep(.group\/pagemain) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dst-mod-detail-spin :deep(.n-spin-content) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dst-mod-detail-desc-card :deep(.n-card-header) {
  flex-shrink: 0;
}

.dst-mod-detail-desc-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
