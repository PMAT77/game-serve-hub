import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const REMOTE_BUILD_CACHE_MS = 30 * 60 * 1000
const APP_INFO_TIMEOUT_MS = 90_000

interface RemoteBuildCacheEntry {
  buildId: string
  checkedAt: number
}

const remoteBuildCache = new Map<string, RemoteBuildCacheEntry>()
const inflightRemoteBuildFetches = new Map<string, Promise<string | null>>()

export interface InstanceUpdateCheckResult {
  localBuildId: string | null
  remoteBuildId: string | null
  updateAvailable: boolean
  checkedAt: string
  message?: string
}

function resolveAppManifestPath(installPath: string, appId: string): string | null {
  const normalizedAppId = appId.trim()
  const candidates = [
    path.join(installPath, 'steamapps', `appmanifest_${normalizedAppId}.acf`),
    path.join(installPath, `appmanifest_${normalizedAppId}.acf`),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export function readLocalBuildId(installPath: string, appId: string): string | null {
  const manifestPath = resolveAppManifestPath(installPath, appId)
  if (!manifestPath) {
    return null
  }
  try {
    const content = fs.readFileSync(manifestPath, 'utf8')
    const match = content.match(/"buildid"\s+"(\d+)"/i)
    return match?.[1] ?? null
  }
  catch {
    return null
  }
}

/** 将 appmanifest 中的 buildid 与远端对齐（安装成功但清单未刷新时使用） */
export function writeLocalBuildId(installPath: string, appId: string, buildId: string): boolean {
  const manifestPath = resolveAppManifestPath(installPath, appId)
  const normalizedBuildId = buildId.trim()
  if (!manifestPath || !normalizedBuildId) {
    return false
  }
  try {
    const content = fs.readFileSync(manifestPath, 'utf8')
    if (!/"buildid"/i.test(content)) {
      return false
    }
    const next = content.replace(
      /"buildid"\s+"\d+"/i,
      `"buildid"\t\t"${normalizedBuildId}"`,
    )
    if (next === content) {
      return false
    }
    fs.writeFileSync(manifestPath, next, 'utf8')
    return true
  }
  catch {
    return false
  }
}

function parsePublicBuildIdFromAppInfo(output: string): string | null {
  const publicIndex = output.indexOf('"public"')
  if (publicIndex >= 0) {
    const section = output.slice(publicIndex, publicIndex + 4000)
    const match = section.match(/"buildid"\s+"(\d+)"/i)
    if (match?.[1]) {
      return match[1]
    }
  }
  const matches = [...output.matchAll(/"buildid"\s+"(\d+)"/gi)]
  return matches.length > 0 ? matches[matches.length - 1][1] : null
}

function runSteamcmdAppInfoAsync(steamcmdCommand: string, appId: string): Promise<{
  ok: boolean
  output: string
}> {
  const normalizedSteamcmdCommand = steamcmdCommand.trim()
  const normalizedAppId = appId.trim()
  if (!normalizedSteamcmdCommand || !normalizedAppId) {
    return Promise.resolve({ ok: false, output: '' })
  }
  const steamcmdArgs = [
    '+@ShutdownOnFailedCommand',
    '1',
    '+@NoPromptForPassword',
    '1',
    '+login',
    'anonymous',
    '+app_info_update',
    '1',
    '+app_info_print',
    normalizedAppId,
    '+quit',
  ]
  const isShellScript = process.platform !== 'win32' && normalizedSteamcmdCommand.endsWith('.sh')
  const command = isShellScript ? 'sh' : normalizedSteamcmdCommand
  const args = isShellScript ? [normalizedSteamcmdCommand, ...steamcmdArgs] : steamcmdArgs

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: { ok: boolean, output: string }) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, output: '' })
    }, APP_INFO_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', () => {
      finish({ ok: false, output: '' })
    })
    child.on('close', (code) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      finish({
        ok: code === 0 || /"appid"\s+"/i.test(output),
        output,
      })
    })
  })
}

export async function fetchRemoteBuildId(
  steamcmdCommand: string,
  appId: string,
  options?: { force?: boolean },
): Promise<string | null> {
  const normalizedAppId = appId.trim()
  if (!normalizedAppId) {
    return null
  }
  const cached = remoteBuildCache.get(normalizedAppId)
  const now = Date.now()
  if (!options?.force && cached && now - cached.checkedAt < REMOTE_BUILD_CACHE_MS) {
    return cached.buildId
  }

  const inflightKey = `${normalizedAppId}::${steamcmdCommand.trim()}`
  const inflight = inflightRemoteBuildFetches.get(inflightKey)
  if (inflight) {
    return inflight
  }

  const task = (async () => {
    const result = await runSteamcmdAppInfoAsync(steamcmdCommand, normalizedAppId)
    if (!result.ok && !result.output) {
      return cached?.buildId ?? null
    }
    const buildId = parsePublicBuildIdFromAppInfo(result.output)
    if (buildId) {
      remoteBuildCache.set(normalizedAppId, { buildId, checkedAt: Date.now() })
    }
    return buildId ?? cached?.buildId ?? null
  })().finally(() => {
    inflightRemoteBuildFetches.delete(inflightKey)
  })

  inflightRemoteBuildFetches.set(inflightKey, task)
  return task
}

export async function checkGameUpdateAvailable(input: {
  installPath: string
  appId: string
  steamcmdCommand: string
  forceRemote?: boolean
}): Promise<InstanceUpdateCheckResult> {
  const checkedAt = new Date().toISOString()
  const localBuildId = readLocalBuildId(input.installPath, input.appId)
  if (!localBuildId) {
    return {
      localBuildId: null,
      remoteBuildId: null,
      updateAvailable: false,
      checkedAt,
      message: '未找到本地安装清单，可能尚未完成安装',
    }
  }
  const remoteBuildId = await fetchRemoteBuildId(input.steamcmdCommand, input.appId, {
    force: input.forceRemote,
  })
  if (!remoteBuildId) {
    return {
      localBuildId,
      remoteBuildId: null,
      updateAvailable: false,
      checkedAt,
      message: '无法获取 Steam 远端版本信息',
    }
  }
  return {
    localBuildId,
    remoteBuildId,
    updateAvailable: localBuildId !== remoteBuildId,
    checkedAt,
  }
}

export function clearRemoteBuildCache(appId?: string) {
  if (appId?.trim()) {
    remoteBuildCache.delete(appId.trim())
    return
  }
  remoteBuildCache.clear()
}
