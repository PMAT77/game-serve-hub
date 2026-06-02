import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { resolveDstSteamWorkshopModDir } from '../../infra/game-adapter/dst/mod-download'
import type { DbInstanceMod } from '../../shared/db/index'
import {
  resetModFileSyncDbHooksForTest,
  setModFileSyncDbHooksForTest,
} from './mod-file-sync-service.ts'
import {
  enqueueModDownload,
  getModInstallJob,
  resetModDownloadDbHooksForTest,
  resetModDownloadExecutorForTest,
  resetModInstallJobsForTest,
  setModDownloadDbHooksForTest,
  setModDownloadExecutorForTest,
  waitForModInstallJob,
} from './mod-download-service.ts'

const tempDirs: string[] = []
const upsertCalls: Array<Record<string, unknown>> = []
const updateCalls: Array<Record<string, unknown>> = []
let listedMods: DbInstanceMod[] = []

function createMockMod(input: Partial<DbInstanceMod> & Pick<DbInstanceMod, 'instanceId' | 'workshopId' | 'name'>): DbInstanceMod {
  const now = new Date().toISOString()
  return {
    id: input.id ?? `mod-${input.workshopId}`,
    previewImage: input.previewImage ?? null,
    enabled: input.enabled ?? false,
    loadOrder: input.loadOrder ?? 0,
    version: input.version ?? null,
    installStatus: input.installStatus ?? 'ready',
    installError: input.installError ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    ...input,
  }
}

function createInstallPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-mod-download-service-'))
  tempDirs.push(dir)
  return dir
}

function writeWorkshopMod(installPath: string, workshopId: string) {
  const modDir = resolveDstSteamWorkshopModDir(installPath, workshopId)
  fs.mkdirSync(modDir, { recursive: true })
  fs.writeFileSync(path.join(modDir, 'modinfo.lua'), 'name = "Test Mod"\n')
}

function installDbHooks() {
  setModFileSyncDbHooksForTest({
    listReadyInstanceMods: async (instanceId: string) =>
      listedMods.filter(mod => mod.instanceId === instanceId && mod.installStatus === 'ready'),
  })
  setModDownloadDbHooksForTest({
    getInstanceModByWorkshopId: async (_instanceId: string, workshopId: string) =>
      listedMods.find(mod => mod.workshopId === workshopId),
    listInstanceMods: async () => listedMods,
    upsertInstanceMod: async (input) => {
      upsertCalls.push(input)
      const existingIndex = listedMods.findIndex(mod => mod.workshopId === input.workshopId)
      const nextMod = createMockMod({
        instanceId: input.instanceId,
        workshopId: input.workshopId,
        name: input.name,
        previewImage: input.previewImage ?? null,
        enabled: input.enabled ?? false,
        loadOrder: input.loadOrder ?? 0,
        version: input.version ?? null,
        installStatus: input.installStatus ?? 'ready',
        installError: input.installError ?? null,
        id: listedMods[existingIndex]?.id,
        createdAt: listedMods[existingIndex]?.createdAt,
      })
      if (existingIndex >= 0) {
        listedMods[existingIndex] = nextMod
      }
      else {
        listedMods.push(nextMod)
      }
      return nextMod
    },
    updateInstanceModByWorkshopId: async (_instanceId: string, workshopId: string, patch) => {
      updateCalls.push({ workshopId, ...patch })
      const existingIndex = listedMods.findIndex(mod => mod.workshopId === workshopId)
      if (existingIndex < 0) {
        return undefined
      }
      listedMods[existingIndex] = createMockMod({
        ...listedMods[existingIndex],
        installStatus: patch.installStatus ?? listedMods[existingIndex].installStatus,
        installError: typeof patch.installError !== 'undefined'
          ? (patch.installError ?? null)
          : listedMods[existingIndex].installError,
        updatedAt: new Date().toISOString(),
      })
      return listedMods[existingIndex]
    },
  })
}

afterEach(() => {
  resetModInstallJobsForTest()
  resetModDownloadExecutorForTest()
  resetModDownloadDbHooksForTest()
  resetModFileSyncDbHooksForTest()
  upsertCalls.length = 0
  updateCalls.length = 0
  listedMods = []
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('mod-download-service', () => {
  it('writes pending record immediately and marks failed when download fails', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    setModDownloadExecutorForTest(async () => ({ ok: false, error: 'mock failure' }))

    const job = await enqueueModDownload({
      instanceId: 'instance-a',
      installPath,
      payload: {
        workshopId: '12345',
        name: 'Failed Mod',
      },
    })
    assert.equal(job.status, 'downloading')
    assert.equal(upsertCalls.length, 1)
    assert.equal(upsertCalls[0]?.installStatus, 'pending')
    await waitForModInstallJob('instance-a', '12345')

    const finished = getModInstallJob('instance-a', '12345')
    assert.equal(finished.status, 'failed')
    assert.equal(finished.error, 'mock failure')
    assert.equal(listedMods[0]?.installStatus, 'failed')
    assert.equal(listedMods[0]?.installError, 'mock failure')
    assert.equal(updateCalls.length, 1)
  })

  it('marks subscription ready after successful download and verification', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    writeWorkshopMod(installPath, '54321')
    setModDownloadExecutorForTest(async () => ({ ok: true }))

    const job = await enqueueModDownload({
      instanceId: 'instance-b',
      installPath,
      payload: {
        workshopId: '54321',
        name: 'Ready Mod',
      },
    })
    assert.equal(job.status, 'downloading')
    await waitForModInstallJob('instance-b', '54321')

    const finished = getModInstallJob('instance-b', '54321')
    assert.equal(finished.status, 'success')
    assert.equal(listedMods[0]?.installStatus, 'ready')
    assert.equal(upsertCalls.some(call => call.installStatus === 'pending'), true)
    assert.equal(upsertCalls.some(call => call.installStatus === 'ready'), true)
    assert.equal(fs.existsSync(path.join(installPath, 'mods', 'dedicated_server_mods_setup.lua')), true)
  })

  it('returns success immediately when mod files already exist and mod is ready', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    writeWorkshopMod(installPath, '77777')
    listedMods = [createMockMod({
      instanceId: 'instance-c',
      workshopId: '77777',
      name: 'Existing Mod',
      installStatus: 'ready',
    })]

    const job = await enqueueModDownload({
      instanceId: 'instance-c',
      installPath,
      payload: {
        workshopId: '77777',
        name: 'Existing Mod',
      },
    })

    assert.equal(job.status, 'success')
    assert.equal(upsertCalls.length, 0)
  })

  it('deduplicates in-flight download jobs for the same workshop id', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    writeWorkshopMod(installPath, '88888')
    let resolveDownload: ((value: { ok: boolean }) => void) | undefined
    const downloadPromise = new Promise<{ ok: boolean }>((resolve) => {
      resolveDownload = resolve
    })
    setModDownloadExecutorForTest(async () => downloadPromise)

    const first = await enqueueModDownload({
      instanceId: 'instance-d',
      installPath,
      payload: { workshopId: '88888', name: 'Queued Mod' },
    })
    const second = await enqueueModDownload({
      instanceId: 'instance-d',
      installPath,
      payload: { workshopId: '88888', name: 'Queued Mod' },
    })

    assert.equal(first.status, 'downloading')
    assert.equal(second.status, 'downloading')
    resolveDownload?.({ ok: true })
    await waitForModInstallJob('instance-d', '88888')
    assert.equal(getModInstallJob('instance-d', '88888').status, 'success')
    assert.equal(upsertCalls.filter(call => call.installStatus === 'pending').length, 1)
  })
})
