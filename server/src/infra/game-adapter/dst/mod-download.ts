import fs from 'node:fs'
import path from 'node:path'
import { runSteamcmdWorkshopDownloadInContainer } from '../../container/steamcmd-runner'
import { DST_CLUSTER_NAME, DST_WORKSHOP_APP_ID } from './constants'

const DEFAULT_WORKSHOP_DOWNLOAD_TIMEOUT_MS = readPositiveIntEnv('GSH_STEAMCMD_WORKSHOP_DOWNLOAD_TIMEOUT_MS', 10 * 60 * 1000)

function readPositiveIntEnv(key: string, fallback: number): number {
  const rawValue = process.env[key]
  if (!rawValue) {
    return fallback
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function normalizeWorkshopIds(workshopIds: string[]): string[] {
  const unique = new Set<string>()
  for (const workshopId of workshopIds) {
    const normalized = workshopId.trim()
    if (normalized) {
      unique.add(normalized)
    }
  }
  return [...unique]
}

function hasModMarkerFiles(modDir: string): boolean {
  if (!fs.existsSync(modDir)) {
    return false
  }
  return fs.existsSync(path.join(modDir, 'modinfo.lua'))
    || fs.existsSync(path.join(modDir, 'modmain.lua'))
}

export function resolveDstSteamWorkshopModDir(installPath: string, workshopId: string): string {
  return path.join(installPath, 'steamapps', 'workshop', 'content', DST_WORKSHOP_APP_ID, workshopId)
}

function resolveDstUgcModDirs(installPath: string, workshopId: string): string[] {
  const clusterRoot = path.join(installPath, 'ugc_mods', DST_CLUSTER_NAME)
  return ['Master', 'Caves'].map(shard =>
    path.join(clusterRoot, shard, 'content', DST_WORKSHOP_APP_ID, workshopId),
  )
}

export function isDstWorkshopModPresent(installPath: string, workshopId: string): boolean {
  const normalizedId = workshopId.trim()
  if (!normalizedId) {
    return false
  }
  if (hasModMarkerFiles(resolveDstSteamWorkshopModDir(installPath, normalizedId))) {
    return true
  }
  return resolveDstUgcModDirs(installPath, normalizedId).some(hasModMarkerFiles)
}

export function collectMissingWorkshopIds(installPath: string, workshopIds: string[]): string[] {
  return normalizeWorkshopIds(workshopIds).filter(workshopId => !isDstWorkshopModPresent(installPath, workshopId))
}

export function formatModDownloadFailureMessage(output: string): string {
  const text = output.trim()
  if (!text) {
    return 'Mod 下载失败，请检查 Steam 网络连接后重试'
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(text)) {
    return 'Mod 下载超时，请检查 Steam 网络连接后重试'
  }
  if (/Access Denied|No subscription|Invalid item/i.test(text)) {
    return '无法下载该 Mod，请确认创意工坊 ID 有效且为公开 Mod'
  }
  if (/Missing file permissions/i.test(text)) {
    return 'Mod 下载失败：实例目录权限不足'
  }
  const tail = text.split(/\r?\n/).slice(-3).join(' ').trim()
  return tail ? `Mod 下载失败：${tail}` : 'Mod 下载失败，请稍后重试'
}

export async function downloadDstWorkshopMods(input: {
  hostInstallPath: string
  workshopIds: string[]
  instanceId: string
  onLogLine?: (line: string) => void
  onAwaitingSteamcmdLock?: () => void | Promise<void>
  onDownloadStart?: () => void | Promise<void>
}): Promise<{ ok: boolean, error?: string }> {
  const missingIds = collectMissingWorkshopIds(input.hostInstallPath, input.workshopIds)
  if (missingIds.length === 0) {
    return { ok: true }
  }

  const result = await runSteamcmdWorkshopDownloadInContainer({
    hostInstallPath: input.hostInstallPath,
    workshopIds: missingIds,
    cancelKey: input.instanceId,
    onLogLine: input.onLogLine,
    onAwaitingSteamcmdLock: input.onAwaitingSteamcmdLock,
    onDownloadStart: input.onDownloadStart,
    timeoutMs: DEFAULT_WORKSHOP_DOWNLOAD_TIMEOUT_MS,
  })

  if (!result.ok) {
    return {
      ok: false,
      error: formatModDownloadFailureMessage(result.output),
    }
  }

  const stillMissing = collectMissingWorkshopIds(input.hostInstallPath, missingIds)
  if (stillMissing.length > 0) {
    return {
      ok: false,
      error: `Mod 下载未完成，缺少文件：${stillMissing.join(', ')}`,
    }
  }

  return { ok: true }
}
