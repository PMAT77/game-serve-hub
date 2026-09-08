import type { FastifyInstance } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type { BackupItem, BackupMutationResult } from '../../../../shared/contracts/backup'
import fs from 'node:fs'
import path from 'node:path'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { OPS_MANAGE_PERMISSION } from '../../shared/menu-routes'
import {
  createBackupRecord,
  deleteBackupRecord,
  getSystemBackupSettings,
  listBackupsByKindAsc,
  newBackupId,
} from '../../shared/db/index'
import { ensureDb } from '../../shared/db/connection'
import { loadServerConfig } from '../../shared/config'
import { businessError, success } from '../../shared/http/response'
import { resolveAuthorizedContext } from './auth'

/** 数据库快照记录在 backups 表中的 instanceId 哨兵值 */
export const DB_BACKUP_INSTANCE_ID = 'panel-db'

function formatTimestampForFile(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 淘汰超出保留上限的最旧数据库快照 */
async function enforceDbSnapshotRetention(app: FastifyInstance, retention: number): Promise<void> {
  if (retention <= 0) {
    return
  }
  const rows = await listBackupsByKindAsc(DB_BACKUP_INSTANCE_ID, ['database'])
  if (rows.length <= retention) {
    return
  }
  for (const item of rows.slice(0, rows.length - retention)) {
    try {
      if (fs.existsSync(item.filePath)) {
        fs.rmSync(item.filePath, { force: true })
      }
      await deleteBackupRecord(item.id)
      app.log.info({ backupId: item.id }, '保留策略淘汰旧数据库快照')
    }
    catch (error) {
      app.log.warn({ backupId: item.id, error }, '淘汰旧数据库快照失败')
    }
  }
}

/**
 * 数据库备份路由：SQLite 一致性快照（VACUUM INTO）。
 * 快照记录 kind=database，由 backup 模块的 list/download/delete 统一管理。
 */
export function registerDatabaseBackupRoutes(app: FastifyInstance) {
  app.post('/app/system/db/backup', async (request): Promise<ApiSuccessResponse<BackupMutationResult> | ApiErrorResponse> => {
    const auth = await resolveAuthorizedContext(request, { permissions: OPS_MANAGE_PERMISSION })
    if (auth.error || !auth.context) {
      return auth.error ?? businessError('登录状态失效，请重新登录', request)
    }

    const { sqliteDb } = ensureDb()
    const settings = await getSystemBackupSettings()
    const dbDir = path.join(loadServerConfig().backupsRoot, 'db')
    fs.mkdirSync(dbDir, { recursive: true })
    // 同秒重复创建时加随机后缀防撞名；VACUUM INTO 要求目标文件不存在
    const fileName = `db-${formatTimestampForFile(new Date())}-${Math.random().toString(36).slice(2, 8)}.sqlite`
    const targetPath = path.join(dbDir, fileName)

    try {
      sqliteDb.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'VACUUM INTO 失败'
      app.log.error({ error: message }, '数据库快照创建失败')
      return businessError(`数据库快照创建失败: ${message}`, request, ErrorCode.BACKUP_CREATE_FAILED)
    }

    let sizeBytes = 0
    try {
      sizeBytes = fs.statSync(targetPath).size
    }
    catch {
      sizeBytes = 0
    }

    const record = await createBackupRecord({
      id: newBackupId(),
      instanceId: DB_BACKUP_INSTANCE_ID,
      filePath: targetPath,
      sizeBytes,
      note: '面板数据库一致性快照',
      kind: 'database',
      status: 'completed',
      createdBy: auth.context.user.account,
    })

    await enforceDbSnapshotRetention(app, settings.dbSnapshotRetention)
    return success({ isSuccess: true, backupId: record.id }, request)
  })

  app.get('/app/system/db/backup', async (request): Promise<ApiSuccessResponse<BackupItem[]> | ApiErrorResponse> => {
    const auth = await resolveAuthorizedContext(request, { permissions: OPS_MANAGE_PERMISSION })
    if (auth.error || !auth.context) {
      return auth.error ?? businessError('登录状态失效，请重新登录', request)
    }
    const rows = await listBackupsByKindAsc(DB_BACKUP_INSTANCE_ID, ['database'])
    return success(rows.reverse().map(record => ({
      id: record.id,
      instanceId: record.instanceId,
      kind: record.kind,
      status: record.status,
      fileName: path.basename(record.filePath),
      sizeBytes: record.sizeBytes,
      note: record.note,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
    })), request)
  })
}
