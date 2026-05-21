import process from 'node:process'

export interface SteamcmdRuntimeConfig {
  downloadRegion: string
  httpProxy: string
  httpsProxy: string
  noProxy: string
  networkMode: 'bridge' | 'host'
  installMaxAttempts: number
  installRetryDelaysMs: number[]
}

const DEFAULT_INSTALL_MAX_ATTEMPTS = 5
const DEFAULT_INSTALL_RETRY_DELAYS_MS = [4000, 8000, 8000, 8000]

function parseInstallMaxAttempts(): number {
  const raw = process.env.GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS?.trim()
  if (!raw) {
    return DEFAULT_INSTALL_MAX_ATTEMPTS
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_INSTALL_MAX_ATTEMPTS
  }
  return Math.min(Math.floor(parsed), 20)
}

function parseInstallRetryDelaysMs(): number[] {
  const raw = process.env.GSH_STEAMCMD_INSTALL_RETRY_DELAYS_MS?.trim()
  if (!raw) {
    return [...DEFAULT_INSTALL_RETRY_DELAYS_MS]
  }
  const delays = raw
    .split(',')
    .map(item => Number(item.trim()))
    .filter(value => Number.isFinite(value) && value > 0)
  if (delays.length === 0) {
    return [...DEFAULT_INSTALL_RETRY_DELAYS_MS]
  }
  return delays
}

/** 读取 panel.env 中的 SteamCMD 运行时调优项（安装容器专用） */
export function loadSteamcmdRuntimeConfig(): SteamcmdRuntimeConfig {
  const downloadRegion = process.env.GSH_STEAMCMD_DOWNLOAD_REGION?.trim() ?? ''
  const httpProxy = process.env.GSH_STEAMCMD_HTTP_PROXY?.trim() ?? ''
  const httpsProxy = process.env.GSH_STEAMCMD_HTTPS_PROXY?.trim() || httpProxy
  const noProxy = process.env.GSH_STEAMCMD_NO_PROXY?.trim() ?? ''
  const networkModeRaw = process.env.GSH_STEAMCMD_NETWORK_MODE?.trim().toLowerCase() ?? ''

  return {
    downloadRegion,
    httpProxy,
    httpsProxy,
    noProxy,
    networkMode: networkModeRaw === 'host' ? 'host' : 'bridge',
    installMaxAttempts: parseInstallMaxAttempts(),
    installRetryDelaysMs: parseInstallRetryDelaysMs(),
  }
}

export function resolveSteamcmdInstallMaxAttempts(): number {
  return parseInstallMaxAttempts()
}

export function resolveSteamcmdInstallRetryDelaysMs(): number[] {
  return parseInstallRetryDelaysMs()
}

/** 注入 SteamCMD 临时容器的代理与区域环境变量 */
export function buildSteamcmdContainerEnv(config: SteamcmdRuntimeConfig = loadSteamcmdRuntimeConfig()): string[] {
  const env: string[] = []
  if (config.httpProxy) {
    env.push(`http_proxy=${config.httpProxy}`, `HTTP_PROXY=${config.httpProxy}`)
  }
  if (config.httpsProxy) {
    env.push(`https_proxy=${config.httpsProxy}`, `HTTPS_PROXY=${config.httpsProxy}`)
  }
  if (config.noProxy) {
    env.push(`no_proxy=${config.noProxy}`, `NO_PROXY=${config.noProxy}`)
  }
  if (config.downloadRegion) {
    env.push('STEAMCMD_FORCE_DOWNLOAD_REGION=china')
  }
  return env
}
