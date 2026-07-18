import type { MaybeRefOrGetter } from 'vue'
import type {
  ModInstallJobDto,
  ModInstallJobPhase,
  ModInstallPayload,
  ModItemDto,
  ModListDto,
} from '@/api/modules/mod'
import { computed, ref, toValue } from 'vue'
import apiMod from '@/api/modules/mod'

export interface ModInstallHandlers {
  onUpdate?: (job: ModInstallJobDto) => void
  onTerminal?: (job: ModInstallJobDto) => void
}

export function useInstanceModState(instanceId: MaybeRefOrGetter<string>) {
  const subscribingWorkshopIds = ref<Set<string>>(new Set())
  const subscribingPhases = ref<Map<string, ModInstallJobPhase>>(new Map())
  const activeInstallJobs = ref<ModInstallJobDto[]>([])
  const pendingModRecords = ref<ModItemDto[]>([])

  const backgroundPollers = new Set<string>()

  const pendingWorkshopIds = computed(() => {
    const ids = new Set(subscribingWorkshopIds.value)
    for (const job of activeInstallJobs.value) {
      if (job.status === 'downloading') {
        ids.add(job.workshopId)
      }
    }
    for (const mod of pendingModRecords.value) {
      if (mod.installStatus === 'pending') {
        ids.add(mod.workshopId)
      }
    }
    return ids
  })

  const downloadingMods = computed(() => {
    const byWorkshopId = new Map<string, ModItemDto>()
    for (const mod of pendingModRecords.value) {
      if (mod.installStatus === 'pending') {
        byWorkshopId.set(mod.workshopId, mod)
      }
    }
    for (const job of activeInstallJobs.value) {
      if (job.status !== 'downloading') {
        continue
      }
      if (!byWorkshopId.has(job.workshopId)) {
        byWorkshopId.set(job.workshopId, {
          id: job.workshopId,
          workshopId: job.workshopId,
          name: job.mod?.name ?? `Workshop Mod ${job.workshopId}`,
          previewImage: job.mod?.previewImage ?? null,
          rating: job.mod?.rating ?? null,
          enabled: false,
          loadOrder: 0,
          version: null,
          installStatus: 'pending',
          installError: null,
          dependencyIds: [],
          missingDependencyIds: [],
          dependentModIds: [],
          createdAt: job.startedAt ?? '',
          updatedAt: job.startedAt ?? '',
        })
      }
    }
    return [...byWorkshopId.values()]
  })

  function resolveInstanceId(): string {
    return toValue(instanceId).trim()
  }

  function trackDownloadingJob(job: ModInstallJobDto) {
    if (job.status !== 'downloading') {
      return
    }
    subscribingWorkshopIds.value = new Set([...subscribingWorkshopIds.value, job.workshopId])
    if (job.phase) {
      subscribingPhases.value = new Map(subscribingPhases.value).set(job.workshopId, job.phase)
    }
  }

  function clearTracking(workshopId: string) {
    const nextIds = new Set(subscribingWorkshopIds.value)
    nextIds.delete(workshopId)
    subscribingWorkshopIds.value = nextIds
    const nextPhases = new Map(subscribingPhases.value)
    nextPhases.delete(workshopId)
    subscribingPhases.value = nextPhases
  }

  function finalizeJobState(job: ModInstallJobDto) {
    clearTracking(job.workshopId)
    activeInstallJobs.value = activeInstallJobs.value.filter(
      item => item.workshopId !== job.workshopId,
    )
    if (job.status === 'downloading') {
      activeInstallJobs.value = [...activeInstallJobs.value, job]
      trackDownloadingJob(job)
      return
    }
    if (job.status === 'failed') {
      const existing = pendingModRecords.value.some(mod => mod.workshopId === job.workshopId)
      pendingModRecords.value = existing
        ? pendingModRecords.value.map(mod => (
            mod.workshopId === job.workshopId
              ? { ...mod, installStatus: 'failed', installError: job.error }
              : mod
          ))
        : pendingModRecords.value
      return
    }
    if (job.status === 'success') {
      pendingModRecords.value = pendingModRecords.value.filter(
        mod => mod.workshopId !== job.workshopId,
      )
    }
  }

  function isPendingWorkshop(workshopId: string): boolean {
    return pendingWorkshopIds.value.has(workshopId)
  }

  function resolveSubscribeButtonText(workshopId: string, subscribed: boolean): string {
    if (subscribed) {
      return '取消订阅'
    }
    if (isPendingWorkshop(workshopId)) {
      return '订阅中'
    }
    return '订阅'
  }

  function resumeBackgroundPoll(workshopId: string, handlers?: ModInstallHandlers) {
    const id = resolveInstanceId()
    if (!id || backgroundPollers.has(workshopId)) {
      return
    }
    backgroundPollers.add(workshopId)
    void (async () => {
      try {
        const job = await apiMod.pollModInstallJob(id, workshopId, {
          onUpdate: (current) => {
            if (current.status === 'downloading') {
              trackDownloadingJob(current)
            }
            else {
              finalizeJobState(current)
            }
            handlers?.onUpdate?.(current)
          },
        })
        finalizeJobState(job)
        handlers?.onTerminal?.(job)
      }
      finally {
        backgroundPollers.delete(workshopId)
      }
    })()
  }

  async function restoreInstallJobs(handlers?: ModInstallHandlers & {
    modList?: ModListDto
  }) {
    const id = resolveInstanceId()
    if (!id) {
      subscribingWorkshopIds.value = new Set()
      subscribingPhases.value = new Map()
      activeInstallJobs.value = []
      pendingModRecords.value = []
      return
    }

    let jobs = handlers?.modList?.activeInstallJobs ?? []
    let mods = handlers?.modList?.mods ?? []
    if (!handlers?.modList) {
      const [jobsResponse, listResponse] = await Promise.all([
        apiMod.listModInstallJobs(id),
        apiMod.getModList(id),
      ])
      jobs = jobsResponse.data
      mods = listResponse.data.mods
      activeInstallJobs.value = jobs
    }
    else {
      activeInstallJobs.value = jobs
    }

    pendingModRecords.value = mods.filter(mod => mod.installStatus === 'pending' || mod.installStatus === 'failed')

    for (const job of jobs) {
      if (job.status === 'downloading') {
        finalizeJobState(job)
        resumeBackgroundPoll(job.workshopId, handlers)
      }
    }

    for (const mod of pendingModRecords.value) {
      if (mod.installStatus === 'pending' && !backgroundPollers.has(mod.workshopId)) {
        subscribingWorkshopIds.value = new Set([...subscribingWorkshopIds.value, mod.workshopId])
        if (!jobs.some(job => job.workshopId === mod.workshopId && job.status === 'downloading')) {
          resumeBackgroundPoll(mod.workshopId, handlers)
        }
      }
    }
  }

  async function installMod(payload: ModInstallPayload, handlers?: ModInstallHandlers) {
    const id = resolveInstanceId()
    if (!id) {
      throw new Error('实例 ID 不能为空')
    }
    trackDownloadingJob({
      instanceId: id,
      workshopId: payload.workshopId,
      status: 'downloading',
      phase: 'downloading',
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    })
    const { data: initialJob } = await apiMod.installMod(id, payload)
    if (initialJob.status === 'downloading') {
      finalizeJobState(initialJob)
      resumeBackgroundPoll(payload.workshopId, handlers)
      return initialJob
    }
    finalizeJobState(initialJob)
    handlers?.onTerminal?.(initialJob)
    return initialJob
  }

  function syncPendingWorkshopIds(ids: string[], handlers?: ModInstallHandlers) {
    for (const workshopId of ids) {
      subscribingWorkshopIds.value = new Set([...subscribingWorkshopIds.value, workshopId])
      resumeBackgroundPoll(workshopId, handlers)
    }
  }

  function resetState() {
    subscribingWorkshopIds.value = new Set()
    subscribingPhases.value = new Map()
    activeInstallJobs.value = []
    pendingModRecords.value = []
    backgroundPollers.clear()
  }

  return {
    subscribingWorkshopIds,
    subscribingPhases,
    activeInstallJobs,
    pendingModRecords,
    pendingWorkshopIds,
    downloadingMods,
    isPendingWorkshop,
    resolveSubscribeButtonText,
    restoreInstallJobs,
    installMod,
    resumeBackgroundPoll,
    syncPendingWorkshopIds,
    resetState,
  }
}
