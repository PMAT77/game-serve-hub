import process from 'node:process'
import { resolveDockerStatus } from '../docker'
import { loadSteamcmdRuntimeConfig } from '../../shared/config/steamcmd'
import { getServerContainerConfig } from '../../shared/config/container'

const STEAMCDN_PROBE_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'
const STEAM_STORE_HOST = 'store.steampowered.com'

export interface SteamcmdDiagnosticsCheck {
  id: string
  ok: boolean
  message: string
}

export interface SteamcmdDiagnosticsResult {
  checks: SteamcmdDiagnosticsCheck[]
  config: {
    downloadRegion: string
    networkMode: string
    httpProxyConfigured: boolean
    httpsProxyConfigured: boolean
    installMaxAttempts: number
    installRetryDelaysMs: number[]
    steamcmdImage: string
  }
  suggestions: string[]
}

async function probeSteamCdn(timeoutMs = 10_000): Promise<{ ok: boolean, message: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(STEAMCDN_PROBE_URL, {
      method: 'HEAD',
      signal: controller.signal,
    })
    if (response.ok) {
      return { ok: true, message: `SteamCDN 可达（HTTP ${response.status}）` }
    }
    return { ok: false, message: `SteamCDN 响应异常（HTTP ${response.status}）` }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `SteamCDN 探测失败：${message}` }
  }
  finally {
    clearTimeout(timer)
  }
}

function buildSuggestions(input: {
  cdnOk: boolean
  dockerOk: boolean
  config: ReturnType<typeof loadSteamcmdRuntimeConfig>
}): string[] {
  const suggestions: string[] = []
  if (!input.dockerOk) {
    suggestions.push('Docker 不可用：请确认 docker.sock 已挂载且 Docker 服务已启动。')
  }
  if (!input.cdnOk) {
    if (!input.config.downloadRegion) {
      suggestions.push('在 panel.env 设置 GSH_STEAMCMD_DOWNLOAD_REGION=cn（或 shanghai/beijing）强制国内 CDN 节点。')
    }
    if (!input.config.httpsProxy && !input.config.httpProxy) {
      suggestions.push('若区域强制仍失败，可配置 GSH_STEAMCMD_HTTPS_PROXY 使用 HTTP/SOCKS 代理。')
    }
    suggestions.push('检查宿主机 DNS（建议 223.5.5.5 / 114.114.114.114）与系统时间同步（chrony）。')
    if (input.config.networkMode !== 'host') {
      suggestions.push('持续超时时可尝试 GSH_STEAMCMD_NETWORK_MODE=host 后重启面板。')
    }
  }
  if (input.config.downloadRegion && input.cdnOk) {
    suggestions.push(`当前已强制 Steam 下载区域：${input.config.downloadRegion}。`)
  }
  if (suggestions.length === 0) {
    suggestions.push('基础连通性正常；若安装仍失败，请查看实例安装日志中的 SteamCMD 输出。')
  }
  return suggestions
}

export async function runSteamcmdDiagnostics(): Promise<SteamcmdDiagnosticsResult> {
  const steamcmdConfig = loadSteamcmdRuntimeConfig()
  const containerConfig = getServerContainerConfig()
  const dockerStatus = await resolveDockerStatus(true)
  const dockerOk = dockerStatus === 'running'

  const cdnProbe = await probeSteamCdn()
  const checks: SteamcmdDiagnosticsCheck[] = [
    {
      id: 'docker',
      ok: dockerOk,
      message: dockerOk ? 'Docker 引擎可用' : `Docker 不可用（${dockerStatus}）`,
    },
    {
      id: 'steamcdn',
      ok: cdnProbe.ok,
      message: cdnProbe.message,
    },
    {
      id: 'steam_store_dns',
      ok: true,
      message: `Steam 商店域名：${STEAM_STORE_HOST}（HTTPS 443，由 SteamCMD 安装时使用）`,
    },
    {
      id: 'download_region',
      ok: Boolean(steamcmdConfig.downloadRegion),
      message: steamcmdConfig.downloadRegion
        ? `已配置下载区域：${steamcmdConfig.downloadRegion}`
        : '未配置 GSH_STEAMCMD_DOWNLOAD_REGION（国内服务器建议设为 cn）',
    },
    {
      id: 'network_mode',
      ok: true,
      message: `SteamCMD 容器网络模式：${steamcmdConfig.networkMode}`,
    },
  ]

  return {
    checks,
    config: {
      downloadRegion: steamcmdConfig.downloadRegion,
      networkMode: steamcmdConfig.networkMode,
      httpProxyConfigured: Boolean(steamcmdConfig.httpProxy),
      httpsProxyConfigured: Boolean(steamcmdConfig.httpsProxy),
      installMaxAttempts: steamcmdConfig.installMaxAttempts,
      installRetryDelaysMs: steamcmdConfig.installRetryDelaysMs,
      steamcmdImage: containerConfig.steamcmdImage,
    },
    suggestions: buildSuggestions({
      cdnOk: cdnProbe.ok,
      dockerOk,
      config: steamcmdConfig,
    }),
  }
}

/** 供测试：是否跳过外网探测 */
export function isSteamcmdDiagnosticsOfflineMode(): boolean {
  return process.env.GSH_STEAMCMD_DIAGNOSTICS_SKIP_NETWORK?.trim() === '1'
}
