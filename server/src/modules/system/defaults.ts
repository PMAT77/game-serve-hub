import type { DbSystemNetworkConfig, DbSystemPanelSettings, DbSystemSteamcmdConfig } from '../../shared/db/index'
import path from 'node:path'
import { getServerContainerConfig } from '../../shared/config/container'

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
  checkUpdateBeforeStart?: boolean
  updateCheckIntervalHours?: number
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
    checkUpdateBeforeStart: false,
    updateCheckIntervalHours: 3,
  }
}

export function getDefaultSteamcmdConfig(): DbSystemSteamcmdConfig {
  const { steamcmdImage, instancesRoot } = getServerContainerConfig()
  return {
    steamcmdPath: steamcmdImage,
    installRoot: instancesRoot,
  }
}

export function normalizeSteamcmdConfigBody(body: SteamcmdConfigBody): DbSystemSteamcmdConfig {
  const defaults = getDefaultSteamcmdConfig()
  const steamcmdPath = body.steamcmdPath?.trim() || defaults.steamcmdPath
  const installRoot = body.installRoot?.trim() || defaults.installRoot
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
