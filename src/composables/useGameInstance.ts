import type { InstanceItem } from '@/api/modules/instance'
import { isDstGameCode } from '@/constants/games'

export function isInstallableGameInstance(
  item: Pick<InstanceItem, 'gameCode' | 'status'>,
): boolean {
  return isDstGameCode(item.gameCode) && item.status !== 'pending_install'
}

export function instanceSupportsDstRoom(item: Pick<InstanceItem, 'gameCode'>): boolean {
  return isDstGameCode(item.gameCode)
}
