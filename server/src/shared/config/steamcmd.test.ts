import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  buildSteamcmdContainerEnv,
  loadSteamcmdRuntimeConfig,
  resolveSteamcmdInstallMaxAttempts,
  resolveSteamcmdInstallRetryDelaysMs,
} from './steamcmd.ts'

const ENV_KEYS = [
  'GSH_STEAMCMD_DOWNLOAD_REGION',
  'GSH_STEAMCMD_HTTP_PROXY',
  'GSH_STEAMCMD_HTTPS_PROXY',
  'GSH_STEAMCMD_NO_PROXY',
  'GSH_STEAMCMD_NETWORK_MODE',
  'GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS',
  'GSH_STEAMCMD_INSTALL_RETRY_DELAYS_MS',
] as const

function clearSteamcmdEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

describe('loadSteamcmdRuntimeConfig', () => {
  afterEach(() => {
    clearSteamcmdEnv()
  })

  it('defaults install max attempts to 5', () => {
    assert.equal(resolveSteamcmdInstallMaxAttempts(), 5)
  })

  it('parses download region and network mode', () => {
    process.env.GSH_STEAMCMD_DOWNLOAD_REGION = 'cn'
    process.env.GSH_STEAMCMD_NETWORK_MODE = 'host'
    const config = loadSteamcmdRuntimeConfig()
    assert.equal(config.downloadRegion, 'cn')
    assert.equal(config.networkMode, 'host')
  })

  it('parses retry delays from comma-separated env', () => {
    process.env.GSH_STEAMCMD_INSTALL_RETRY_DELAYS_MS = '5000,10000'
    assert.deepEqual(resolveSteamcmdInstallRetryDelaysMs(), [5000, 10000])
  })

  it('builds proxy env for SteamCMD container', () => {
    process.env.GSH_STEAMCMD_HTTPS_PROXY = 'http://127.0.0.1:7890'
    process.env.GSH_STEAMCMD_DOWNLOAD_REGION = 'cn'
    const env = buildSteamcmdContainerEnv()
    assert.ok(env.includes('https_proxy=http://127.0.0.1:7890'))
    assert.ok(env.includes('STEAMCMD_FORCE_DOWNLOAD_REGION=china'))
  })
})
