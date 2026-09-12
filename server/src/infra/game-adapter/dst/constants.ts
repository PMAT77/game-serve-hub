import path from 'node:path'

export const DST_APP_ID = '343050'
/** DST 创意工坊 UGC AppID（与 steamapps/workshop/content 路径一致） */
export const DST_WORKSHOP_APP_ID = '322330'
export const DST_CLUSTER_NAME = 'Cluster_1'
export const DST_CONF_DIR = 'DoNotStarveTogether'
export const DST_STORAGE_DIR = 'klei-storage'
export const DST_DEFAULT_GAME_PORT = 10999
export const DST_CONTAINER_GAME_ROOT = '/game'

/**
 * SteamCMD 下载创意工坊 Mod 的落地目录。
 * 注意：DST 专用服不读该位置，需再落位到 ugc_mods（见 ugc-mod-install.ts）。
 */
export function resolveDstSteamWorkshopModDir(installPath: string, workshopId: string): string {
  return path.join(installPath, 'steamapps', 'workshop', 'content', DST_WORKSHOP_APP_ID, workshopId)
}
