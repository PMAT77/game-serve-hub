<script setup lang="ts">
import type { InstanceItem } from '@/api/modules/instance'
import { NButton, NCard } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import apiInstance from '@/api/modules/instance'
import {
  GETTING_STARTED_MOD_STEP,
  GETTING_STARTED_STEPS,
  isGettingStartedDismissed,
  resolveGettingStartedProgress,
  setGettingStartedDismissed,
} from '../gettingStarted'

defineOptions({
  name: 'MonitorGettingStartedCard',
})

const router = useRouter()
const appAccountStore = useAppAccountStore()

const visible = ref(false)
const loading = ref(false)
const instances = ref<InstanceItem[]>([])

const progress = computed(() => resolveGettingStartedProgress({
  instanceCount: instances.value.length,
  runningInstanceCount: instances.value.filter(item => item.status === 'running').length,
}))

const currentStep = computed(() =>
  GETTING_STARTED_STEPS.find(step => step.id === progress.value.currentStepId) ?? GETTING_STARTED_STEPS[0]!,
)

function isCompleted(stepId: string): boolean {
  return progress.value.completedStepIds.includes(stepId)
}

function isCurrent(stepId: string): boolean {
  return progress.value.currentStepId === stepId
}

async function loadInstances() {
  loading.value = true
  try {
    const res = await apiInstance.getInstanceList()
    instances.value = (res.data as InstanceItem[]) ?? []
  }
  catch {
    instances.value = []
  }
  finally {
    loading.value = false
  }
}

function openDoc(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function goStep(to: unknown) {
  if (to) {
    router.push(to as never)
  }
}

function dismiss() {
  setGettingStartedDismissed(appAccountStore.account)
  visible.value = false
}

onMounted(async () => {
  if (isGettingStartedDismissed(appAccountStore.account)) {
    return
  }
  visible.value = true
  await loadInstances()
})
</script>

<template>
  <NCard v-if="visible" title="开始使用" size="small" class="mb-4">
    <template #header-extra>
      <NButton text size="tiny" @click="dismiss">
        不再显示
      </NButton>
    </template>

    <p class="mb-3 text-sm text-muted-foreground">
      {{ progress.summary }}
    </p>

    <ol class="space-y-2">
      <li
        v-for="step in GETTING_STARTED_STEPS"
        :key="step.id"
        class="rounded-md border px-3 py-2"
        :class="isCurrent(step.id) ? 'border-primary/60' : ''"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="text-xs"
            :class="isCompleted(step.id) ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'"
          >
            {{ isCompleted(step.id) ? '已完成' : (isCurrent(step.id) ? '当前步骤' : '待办') }}
          </span>
          <span class="text-sm font-medium">{{ step.title }}</span>
          <NButton
            v-if="step.to"
            text
            size="tiny"
            @click="goStep(step.to)"
          >
            前往
          </NButton>
          <NButton text size="tiny" @click="openDoc(step.docUrl)">
            看文档
          </NButton>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ step.description }}
        </p>
      </li>
    </ol>

    <div class="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      <span class="text-sm">
        {{ GETTING_STARTED_MOD_STEP.title }}：
      </span>
      <NButton v-if="GETTING_STARTED_MOD_STEP.to" text size="tiny" @click="goStep(GETTING_STARTED_MOD_STEP.to)">
        前往
      </NButton>
      <NButton text size="tiny" @click="openDoc(GETTING_STARTED_MOD_STEP.docUrl)">
        看文档
      </NButton>
      <span class="text-xs text-muted-foreground">
        {{ GETTING_STARTED_MOD_STEP.description }}
      </span>
    </div>

    <p v-if="loading" class="mt-2 text-xs text-muted-foreground">
      正在读取实例状态……
    </p>
    <p v-if="!loading && currentStep" class="mt-2 text-xs text-muted-foreground">
      下一步：{{ currentStep.title }}
    </p>
  </NCard>
</template>
