import fs from 'node:fs'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getCachedDockerStatus, resolveDockerStatus } from '../docker'
import { isSteamcmdImagePresent } from '../container/steamcmd-runner'
import { loadServerConfig, type ServerConfig } from '../../shared/config'

const execFileAsync = promisify(execFile)
const RUNTIME_STATUS_CACHE_MS = 30_000
const RUNTIME_PROBE_TIMEOUT_MS = 5_000

export type RuntimeMode = ServerConfig['runtimeMode']
export type RuntimeStatus = 'running' | 'stopped'

let nativeStatusCache: { value: RuntimeStatus, expiresAt: number } | undefined
let nativeStatusInFlight: Promise<RuntimeStatus> | undefined

async function probeNativeRuntimeStatus(): Promise<RuntimeStatus> {
  if (process.platform !== 'linux') {
    return 'stopped'
  }
  try {
    await execFileAsync('systemctl', ['--user', 'show-environment'], {
      timeout: RUNTIME_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    return 'running'
  }
  catch {
    return 'stopped'
  }
}

function writeNativeStatusCache(value: RuntimeStatus) {
  nativeStatusCache = {
    value,
    expiresAt: Date.now() + RUNTIME_STATUS_CACHE_MS,
  }
}

function scheduleNativeStatusRefresh(force = false) {
  if (!force && nativeStatusCache && nativeStatusCache.expiresAt > Date.now()) {
    return
  }
  if (nativeStatusInFlight) {
    return
  }
  nativeStatusInFlight = probeNativeRuntimeStatus()
    .then((value) => {
      writeNativeStatusCache(value)
      return value
    })
    .finally(() => {
      nativeStatusInFlight = undefined
    })
}

export function getRuntimeMode(): RuntimeMode {
  return loadServerConfig().runtimeMode
}

export async function resolveRuntimeStatus(force = false): Promise<RuntimeStatus> {
  if (getRuntimeMode() === 'docker') {
    return resolveDockerStatus(force)
  }
  if (!force && nativeStatusCache && nativeStatusCache.expiresAt > Date.now()) {
    return nativeStatusCache.value
  }
  if (!nativeStatusInFlight) {
    scheduleNativeStatusRefresh(true)
  }
  return nativeStatusInFlight!
}

export function getCachedRuntimeStatus(): RuntimeStatus {
  if (getRuntimeMode() === 'docker') {
    return getCachedDockerStatus()
  }
  scheduleNativeStatusRefresh()
  return nativeStatusCache?.value ?? 'stopped'
}

export async function isSteamcmdRuntimeReady(): Promise<boolean> {
  const config = loadServerConfig()
  if (config.runtimeMode === 'docker') {
    return isSteamcmdImagePresent()
  }
  try {
    fs.accessSync(config.nativeSteamcmdPath, fs.constants.X_OK)
    return true
  }
  catch {
    return false
  }
}

export function startRuntimeStatusRefreshLoop() {
  if (getRuntimeMode() !== 'native') {
    return
  }
  scheduleNativeStatusRefresh(true)
  const timer = setInterval(() => scheduleNativeStatusRefresh(true), RUNTIME_STATUS_CACHE_MS)
  if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref()
  }
}
