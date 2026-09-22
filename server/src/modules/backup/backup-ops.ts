import fs from 'node:fs'
import path from 'node:path'
import { deleteBackupRecord, getBackupById, listBackups } from '../../shared/db/index'
import { loadServerConfig } from '../../shared/config'
import { createInstanceBackup } from './backup-service'

/**
 * 备份操作的共用实现。
 *
 * 为什么单独抽出来：这些动作现在有两个调用方——面板路由（登录用户）与插件能力服务
 * （第三方插件）。此前删除逻辑写在路由 handler 里，插件若要用就得复制一遍；
 * 复制的那份迟早会在「先删记录还是先删文件」「文件删除失败怎么算」这些细节上与主路径分叉。
 */

/** 备份文件必须位于备份根目录下（防记录被篡改后的路径穿越） */
export function isInsideBackupsRoot(filePath: string): boolean {
  const root = path.resolve(loadServerConfig().backupsRoot)
  return path.resolve(filePath).startsWith(root + path.sep)
}

export interface BackupOverviewItem {
  id: string
  instanceId: string
  kind: string
  status: string
  fileName: string
  sizeBytes: number
  createdAt: string
  /** 备份包在磁盘上的绝对路径；插件在**同一台机器**上，可直接按需读取上传 */
  filePath: string
  /** 文件此刻是否真的存在（记录在、文件被删掉的情况要能看出来） */
  filePresent: boolean
}

export async function listBackupsForConsumer(instanceId?: string): Promise<BackupOverviewItem[]> {
  const records = await listBackups(instanceId)
  return records.map(record => ({
    id: record.id,
    instanceId: record.instanceId,
    kind: record.kind,
    status: record.status,
    fileName: path.basename(record.filePath),
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    filePath: record.filePath,
    filePresent: fs.existsSync(record.filePath),
  }))
}

export interface CreateBackupForConsumerOptions {
  instanceId: string
  note?: string
  createdBy: string
}

export async function createBackupForConsumer(
  options: CreateBackupForConsumerOptions,
): Promise<{ ok: boolean, message?: string, backupId?: string, fileName?: string, sizeBytes?: number }> {
  const result = await createInstanceBackup({
    instanceId: options.instanceId,
    kind: 'manual',
    note: options.note,
    createdBy: options.createdBy,
  })
  if (!result.ok || !result.backup) {
    return { ok: false, message: result.message ?? '创建备份失败' }
  }
  return {
    ok: true,
    backupId: result.backup.id,
    fileName: path.basename(result.backup.filePath),
    sizeBytes: result.backup.sizeBytes,
  }
}

/**
 * 删除备份：与面板路由同一顺序与判断。
 * 先删记录再删文件，文件删除失败只告警——记录已删，列表自然消失，不会留下"点不动的行"。
 */
export async function deleteBackupForConsumer(backupId: string): Promise<{
  ok: boolean
  message?: string
  fileRemoved?: boolean
}> {
  const record = await getBackupById(backupId)
  if (!record) {
    return { ok: false, message: '备份记录不存在' }
  }
  const inside = isInsideBackupsRoot(record.filePath)
  await deleteBackupRecord(record.id)
  if (!inside || !fs.existsSync(record.filePath)) {
    return { ok: true, fileRemoved: false }
  }
  try {
    fs.rmSync(record.filePath, { force: true })
    return { ok: true, fileRemoved: true }
  }
  catch (error) {
    return {
      ok: true,
      fileRemoved: false,
      message: `备份记录已删除，但文件清理失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
