import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { resolveDstSteamWorkshopModDir } from '../../infra/game-adapter/dst/mod-download'
import { resolveDstUgcModDir } from '../../infra/game-adapter/dst/ugc-mod-install'
import { resolveWorkshopManifestPath } from '../../infra/game-adapter/dst/workshop-manifest'
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
  resolveModInstallJob,
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
    localUpdatedAt: input.localUpdatedAt ?? null,
    remoteUpdatedAt: input.remoteUpdatedAt ?? null,
    updateCheckedAt: input.updateCheckedAt ?? null,
    config: input.config ?? null,
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

/** 写入 SteamCMD 清单条目：本机内容对应的工坊版本时间 */
function writeWorkshopManifest(installPath: string, workshopId: string, timeupdated: number) {
  const manifestPath = resolveWorkshopManifestPath(installPath)
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, [
    '"AppWorkshop"',
    '{',
    '\t"WorkshopItemsInstalled"',
    '\t{',
    `\t\t"${workshopId}"`,
    '\t\t{',
    `\t\t\t"timeupdated"\t\t"${timeupdated}"`,
    '\t\t}',
    '\t}',
    '}',
  ].join('\n'))
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
    // DST 只从 ugc_mods 加载创意工坊 Mod，下载完成即必须完成落位
    assert.equal(fs.existsSync(path.join(resolveDstUgcModDir(installPath, 'Master', '54321'), 'modinfo.lua')), true)
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

  it('force re-downloads a ready mod even when files already exist', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    writeWorkshopMod(installPath, '77777')
    listedMods = [createMockMod({
      instanceId: 'instance-c',
      workshopId: '77777',
      name: 'Existing Mod',
      installStatus: 'ready',
      enabled: true,
    })]
    let downloadCount = 0
    setModDownloadExecutorForTest(async () => {
      downloadCount += 1
      return { ok: true }
    })

    const job = await enqueueModDownload({
      instanceId: 'instance-c',
      installPath,
      payload: {
        workshopId: '77777',
        name: 'Existing Mod',
      },
      force: true,
    })
    assert.equal(job.status, 'downloading')
    await waitForModInstallJob('instance-c', '77777')

    const finished = getModInstallJob('instance-c', '77777')
    assert.equal(finished.status, 'success')
    assert.equal(downloadCount, 1)
    assert.equal(upsertCalls.some(call => call.installStatus === 'pending'), true)
    assert.equal(listedMods[0]?.installStatus, 'ready')
    assert.equal(listedMods[0]?.enabled, true)
  })

  it('records the installed workshop version after a forced update', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    writeWorkshopMod(installPath, '66666')
    writeWorkshopManifest(installPath, '66666', 1_800_000_000)
    listedMods = [createMockMod({
      instanceId: 'instance-e',
      workshopId: '66666',
      name: 'Updated Mod',
      installStatus: 'ready',
    })]
    setModDownloadExecutorForTest(async () => ({ ok: true }))

    await enqueueModDownload({
      instanceId: 'instance-e',
      installPath,
      payload: { workshopId: '66666', name: 'Updated Mod' },
      force: true,
    })
    await waitForModInstallJob('instance-e', '66666')

    const readyCall = upsertCalls.find(call => call.installStatus === 'ready')
    const versionIso = new Date(1_800_000_000 * 1000).toISOString()
    // 本机内容对应的工坊版本时间来自 SteamCMD 清单，更新后必须重新入账
    assert.equal(readyCall?.localUpdatedAt, versionIso)
    // 刚更新过即代表已是最新，避免紧接着又被判成「未知」
    assert.equal(readyCall?.remoteUpdatedAt, versionIso)
    assert.ok(readyCall?.updateCheckedAt)
  })

  it('coalesces other missing mods into one download call', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    listedMods = [
      createMockMod({ instanceId: 'instance-f', workshopId: '100', name: 'Pending A', installStatus: 'pending' }),
      createMockMod({ instanceId: 'instance-f', workshopId: '200', name: 'Pending B', installStatus: 'pending' }),
      createMockMod({ instanceId: 'instance-f', workshopId: '300', name: 'Ready C', installStatus: 'ready' }),
    ]
    writeWorkshopMod(installPath, '300')
    const downloadBatches: string[][] = []
    setModDownloadExecutorForTest(async (input) => {
      downloadBatches.push([...input.workshopIds])
      for (const workshopId of input.workshopIds) {
        writeWorkshopMod(installPath, workshopId)
      }
      return { ok: true }
    })

    await enqueueModDownload({
      instanceId: 'instance-f',
      installPath,
      payload: { workshopId: '100', name: 'Pending A' },
    })
    await waitForModInstallJob('instance-f', '100')

    // 一次 SteamCMD 覆盖两个缺失 Mod；已就绪的 300 不参与
    assert.deepEqual(downloadBatches, [['100', '200']])
    assert.equal(getModInstallJob('instance-f', '100').status, 'success')
    assert.equal(listedMods.find(mod => mod.workshopId === '100')?.installStatus, 'ready')
    assert.equal(listedMods.find(mod => mod.workshopId === '200')?.installStatus, 'ready')
  })

  it('keeps the primary job successful when a coalesced mod is still missing', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    listedMods = [
      createMockMod({ instanceId: 'instance-g', workshopId: '111', name: 'Pending A', installStatus: 'pending' }),
      createMockMod({ instanceId: 'instance-g', workshopId: '222', name: 'Pending B', installStatus: 'pending' }),
    ]
    setModDownloadExecutorForTest(async () => {
      // 只下到了主 Mod，222 仍缺失
      writeWorkshopMod(installPath, '111')
      return { ok: true }
    })

    await enqueueModDownload({
      instanceId: 'instance-g',
      installPath,
      payload: { workshopId: '111', name: 'Pending A' },
    })
    await waitForModInstallJob('instance-g', '111')

    assert.equal(getModInstallJob('instance-g', '111').status, 'success')
    assert.equal(listedMods.find(mod => mod.workshopId === '111')?.installStatus, 'ready')
    // 顺带下载失败的 Mod 只影响它自己，等待下一次重试
    assert.equal(listedMods.find(mod => mod.workshopId === '222')?.installStatus, 'failed')
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

  it('clears failed status before retrying download', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    listedMods.push(createMockMod({
      instanceId: 'instance-e',
      workshopId: '99999',
      name: 'Retry Mod',
      installStatus: 'failed',
      installError: 'previous failure',
    }))
    setModDownloadExecutorForTest(async () => ({ ok: false, error: 'retry failed' }))

    await enqueueModDownload({
      instanceId: 'instance-e',
      installPath,
      payload: { workshopId: '99999', name: 'Retry Mod' },
    })
    await waitForModInstallJob('instance-e', '99999')

    assert.ok(updateCalls.some(call => call.installStatus === 'pending' && call.installError === null))
    assert.equal(listedMods[0]?.installStatus, 'failed')
  })

  it('unpacks a legacy workshop download into ugc_mods and marks the mod ready', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    const modDir = resolveDstSteamWorkshopModDir(installPath, '501385076')
    fs.mkdirSync(modDir, { recursive: true })
    const archive = zipSync({
      'modinfo.lua': strToU8('name = "Quick Pick"\n'),
      'modmain.lua': strToU8('-- main\n'),
    })
    fs.writeFileSync(path.join(modDir, '1665728219799633209_legacy.bin'), Buffer.from(archive))
    setModDownloadExecutorForTest(async () => ({ ok: true }))

    await enqueueModDownload({
      instanceId: 'instance-h',
      installPath,
      payload: { workshopId: '501385076', name: '快速采集' },
    })
    await waitForModInstallJob('instance-h', '501385076')

    assert.equal(getModInstallJob('instance-h', '501385076').status, 'success')
    assert.equal(listedMods[0]?.installStatus, 'ready')
    const ugcModDir = resolveDstUgcModDir(installPath, 'Master', '501385076')
    assert.equal(fs.existsSync(path.join(ugcModDir, 'modmain.lua')), true)
  })

  it('fails the subscription when the downloaded mod cannot be placed into ugc_mods', async () => {
    installDbHooks()
    const installPath = createInstallPath()
    const modDir = resolveDstSteamWorkshopModDir(installPath, '40404')
    fs.mkdirSync(modDir, { recursive: true })
    fs.writeFileSync(path.join(modDir, '123_legacy.bin'), Buffer.from('not a zip'))
    setModDownloadExecutorForTest(async () => ({ ok: true }))

    await enqueueModDownload({
      instanceId: 'instance-g',
      installPath,
      payload: { workshopId: '40404', name: 'Broken Legacy Mod' },
    })
    await waitForModInstallJob('instance-g', '40404')

    const finished = getModInstallJob('instance-g', '40404')
    assert.equal(finished.status, 'failed')
    assert.match(finished.error ?? '', /未能安装到服务器目录/)
    assert.equal(listedMods[0]?.installStatus, 'failed')
    assert.equal(upsertCalls.some(call => call.installStatus === 'ready'), false)
  })

  it('resolveModInstallJob falls back to failed mod record when memory job is gone', async () => {
    installDbHooks()
    listedMods.push(createMockMod({
      instanceId: 'instance-f',
      workshopId: '77777',
      name: 'Failed Memory Mod',
      installStatus: 'failed',
      installError: 'mock failure persisted',
    }))

    const job = await resolveModInstallJob('instance-f', '77777')
    assert.equal(job.status, 'failed')
    assert.equal(job.error, 'mock failure persisted')
  })
})
