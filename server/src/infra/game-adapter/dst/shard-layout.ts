import fs from 'node:fs'
import path from 'node:path'
import { DST_CLUSTER_NAME, DST_CONF_DIR, DST_STORAGE_DIR } from './constants'

export function resolveClusterRoot(installPath: string): string {
  return path.join(installPath, DST_STORAGE_DIR, DST_CONF_DIR, DST_CLUSTER_NAME)
}

export function resolveCavesServerIniPath(installPath: string): string {
  return path.join(resolveClusterRoot(installPath), 'Caves', 'server.ini')
}

/** FDS-04：启用分片前须存在洞穴 world 配置（至少 Caves/server.ini） */
export function isCavesShardConfigured(installPath: string): boolean {
  return fs.existsSync(resolveCavesServerIniPath(installPath))
}

export const SHARD_ENABLE_BLOCKED_MESSAGE
  = '无法开启洞穴分片：洞穴世界尚未配置完成。请先完成洞穴世界配置后再开启，或保持关闭后保存。'
