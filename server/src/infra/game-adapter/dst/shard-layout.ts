import fs from 'node:fs'
import path from 'node:path'
import type { ShardId } from '../../../../../shared/contracts/shard'
import { DST_CLUSTER_NAME, DST_CONF_DIR, DST_STORAGE_DIR } from './constants'

export function resolveClusterRoot(installPath: string): string {
  return path.join(installPath, DST_STORAGE_DIR, DST_CONF_DIR, DST_CLUSTER_NAME)
}

export function resolveShardRoot(installPath: string, shardId: ShardId): string {
  const folder = shardId === 'master' ? 'Master' : 'Caves'
  return path.join(resolveClusterRoot(installPath), folder)
}

export function resolveMasterServerIniPath(installPath: string): string {
  return path.join(resolveShardRoot(installPath, 'master'), 'server.ini')
}

export function resolveCavesServerIniPath(installPath: string): string {
  return path.join(resolveShardRoot(installPath, 'caves'), 'server.ini')
}

export function resolveShardServerIniPath(installPath: string, shardId: ShardId): string {
  return path.join(resolveShardRoot(installPath, shardId), 'server.ini')
}

export function resolveShardWorldgenPath(installPath: string, shardId: ShardId): string {
  return path.join(resolveShardRoot(installPath, shardId), 'worldgenoverride.lua')
}

export function resolveShardLeveldataPath(installPath: string, shardId: ShardId): string {
  return path.join(resolveShardRoot(installPath, shardId), 'leveldataoverride.lua')
}

export function resolveShardSaveDir(installPath: string, shardId: ShardId): string {
  return path.join(resolveShardRoot(installPath, shardId), 'save')
}

/** 分片 save 目录已有内容时视为世界已生成（地图生成参数此后不可通过面板修改） */
export function isShardWorldGenerated(installPath: string, shardId: ShardId): boolean {
  const saveDir = resolveShardSaveDir(installPath, shardId)
  if (!fs.existsSync(saveDir)) {
    return false
  }
  try {
    return fs.readdirSync(saveDir).length > 0
  }
  catch {
    return false
  }
}

export function isMasterShardConfigured(installPath: string): boolean {
  return fs.existsSync(resolveMasterServerIniPath(installPath))
}

/** FDS-04：启用分片前须存在洞穴 world 配置（至少 Caves/server.ini） */
export function isCavesShardConfigured(installPath: string): boolean {
  return fs.existsSync(resolveCavesServerIniPath(installPath))
}

/** 启动自愈仍失败时的兜底提示（房间保存应已自动生成 Caves 配置） */
export const SHARD_CAVES_CONFIG_MISSING_MESSAGE
  = '洞穴分片配置缺失，请重新保存房间设置（开启启用分片）或检查安装目录权限'
