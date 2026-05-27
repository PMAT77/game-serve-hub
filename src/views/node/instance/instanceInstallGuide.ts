import type { InstanceItem } from '@/api/modules/instance'
import { GAME_CODES } from '@/constants/games'

type InstallStatus = Pick<InstanceItem, 'status'>
type InstallGuideTarget = Pick<InstanceItem, 'gameCode' | 'status'>
type InstallResultTarget = Pick<InstanceItem, 'name' | 'status'>

export interface InstallResultNotificationPayload {
  type: 'success' | 'error'
  title: string
  content: string
  durationMs: number
}

export function shouldShowPostCreateInstallGuide(instance: InstallGuideTarget): boolean {
  return instance.gameCode === GAME_CODES.DST
    && (instance.status === 'pending_install' || instance.status === 'installing')
}

function isInstallTerminalStatus(status: InstallStatus['status']): status is 'stopped' | 'error' {
  return status === 'stopped' || status === 'error'
}

export function buildInstallResultNotification(
  instance: InstallResultTarget,
): InstallResultNotificationPayload | null {
  if (!isInstallTerminalStatus(instance.status)) {
    return null
  }
  if (instance.status === 'stopped') {
    return {
      type: 'success',
      title: '实例安装完成',
      content: `「${instance.name}」安装完成，可以启动实例`,
      durationMs: 5000,
    }
  }
  return {
    type: 'error',
    title: '实例安装失败',
    content: `「${instance.name}」安装失败，请查看安装日志`,
    durationMs: 5000,
  }
}
