import type { DbSystemNetworkConfig, DbSystemPanelSettings, DbSystemSteamcmdConfig } from '../../shared/db/index'
import path from 'node:path'
import process from 'node:process'
import { resolveDefaultInstallRoot, resolveEffectiveInstallRoot } from '../../infra/steamcmd'

export interface NetworkConfigBody {
  mode?: 'bootstrap_pending' | 'managed'
  httpPort?: number
  domain?: string
  tls?: {
    enabled?: boolean
    provider?: 'none' | 'letsencrypt' | 'custom'
  }
}

export interface PanelSettingsBody {
  panelPort?: number
  theme?: 'light' | 'dark' | 'system'
  autoUpdate?: boolean
}

export interface SteamcmdConfigBody {
  steamcmdPath?: string
  installRoot?: string
}

export function getDefaultNetworkConfig(): DbSystemNetworkConfig {
  return {
    mode: 'bootstrap_pending',
    httpPort: 80,
    domain: '',
    tls: {
      enabled: false,
      provider: 'none',
    },
  }
}

export function getDefaultPanelSettings(): DbSystemPanelSettings {
  return {
    panelPort: 80,
    theme: 'system',
    autoUpdate: true,
  }
}

export function getDefaultSteamcmdConfig(): DbSystemSteamcmdConfig {
  const defaultSteamcmdCommand = process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd'
  return {
    steamcmdPath: defaultSteamcmdCommand,
    installRoot: resolveDefaultInstallRoot(defaultSteamcmdCommand),
  }
}

export function normalizeSteamcmdConfigBody(body: SteamcmdConfigBody): DbSystemSteamcmdConfig {
  const defaults = getDefaultSteamcmdConfig()
  const steamcmdPath = body.steamcmdPath?.trim() || defaults.steamcmdPath
  const installRoot = resolveEffectiveInstallRoot(body.installRoot, steamcmdPath)
  return {
    steamcmdPath,
    installRoot,
  }
}

export function validateInstallRootPath(rawPath: string): string | undefined {
  if (!rawPath) {
    return '实例安装根目录不能为空'
  }
  if (!path.isAbsolute(rawPath)) {
    return '实例安装根目录必须是绝对路径'
  }
  if (/[\0`$;&|]/.test(rawPath)) {
    return '实例安装根目录包含危险字符'
  }
}
