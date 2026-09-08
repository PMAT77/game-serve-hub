import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import type {
  BackupItem,
  BackupMutationResult,
  BackupRestoreResult,
  SaveImportProbeResult,
  SaveImportResult,
} from '../../../../shared/contracts/backup'
import {
  backupCreateRequestSchema,
  backupIdRequestSchema,
  backupListRequestSchema,
  backupRestoreRequestSchema,
  saveImportProbeRequestSchema,
  saveImportRequestSchema,
} from '../../../../shared/contracts/backup'
import fs from 'node:fs'
import path from 'node:path'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { OPS_MANAGE_PERMISSION } from '../../shared/menu-routes'
import {
  deleteBackupRecord,
  getBackupById,
  getGameInstanceById,
  listBackups,
  updateBackupStatus,
} from '../../shared/db/index'
import type { DbBackup } from '../../shared/db/index'
import { loadServerConfig } from '../../shared/config'
import { businessError, success } from '../../shared/http/response'
import { resolveAuthorizedContext } from '../system/auth'
import { createInstanceBackup, restoreInstanceBackup } from './backup-service'
import { importSaveToInstance, probeSaveImportSource } from './import-service'

function toBackupItem(record: DbBackup): BackupItem {
  return {
    id: record.id,
    instanceId: record.instanceId,
    kind: record.kind,
    status: record.status,
    fileName: path.basename(record.filePath),
    sizeBytes: record.sizeBytes,
    note: record.note,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
  }
}

/** 备份文件必须位于备份根目录下（防记录被篡改后的路径穿越） */
function isInsideBackupsRoot(filePath: string): boolean {
  const root = path.resolve(loadServerConfig().backupsRoot)
  return path.resolve(filePath).startsWith(root + path.sep)
}

interface BackupAuth {
  error?: ApiErrorResponse
  operatorAccount: string
}

async function authorize(request: FastifyRequest): Promise<BackupAuth> {
  const auth = await resolveAuthorizedContext(request, { permissions: OPS_MANAGE_PERMISSION })
  if (auth.error || !auth.context) {
    return { error: auth.error ?? businessError('登录状态失效，请重新登录', request), operatorAccount: '' }
  }
  return { operatorAccount: auth.context.user.account }
}

/**
 * backup 模块：实例存档备份与恢复、备份文件管理。
 * 存档备份覆盖 klei-storage（世界数据、房间配置、集群令牌），
 * 数据库快照（kind=database）由 system 模块创建、此处统一管理。
 */
export function registerBackupModule(app: FastifyInstance) {
  app.post('/app/instance/backup/create', async (request): Promise<ApiSuccessResponse<BackupMutationResult> | ApiErrorResponse> => {
    const auth = await authorize(request)
    if (auth.error) {
      return auth.error
    }
    const body = backupCreateRequestSchema.safeParse(request.body)
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const result = await createInstanceBackup({
      app,
      instanceId: body.data.instanceId,
      kind: 'manual',
      note: body.data.note ?? '',
      createdBy: auth.operatorAccount,
    })
    if (!result.ok || !result.backup) {
      return businessError(result.message ?? '备份创建失败', request, ErrorCode.BACKUP_CREATE_FAILED)
    }
    return success({ isSuccess: true, backupId: result.backup.id }, request)
  })

  app.post('/app/instance/backup/list', async (request): Promise<ApiSuccessResponse<BackupItem[]> | ApiErrorResponse> => {
    const auth = await authorize(request)
    if (auth.error) {
      return auth.error
    }
    const body = backupListRequestSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const records = await listBackups(body.data.instanceId)
    const items: BackupItem[] = []
    for (const record of records) {
      // 磁盘对账：文件丢失的已完成备份标记 stale（数据库快照丢失同样标记）
      if (record.status === 'completed' && !fs.existsSync(record.filePath)) {
        await updateBackupStatus(record.id, 'stale')
        items.push(toBackupItem({ ...record, status: 'stale' }))
        continue
      }
      items.push(toBackupItem(record))
    }
    return success(items, request)
  })

  app.post('/app/instance/backup/download', async (request, reply): Promise<void> => {
    const auth = await authorize(request)
    if (auth.error) {
      reply.status(401).send(auth.error)
      return
    }
    const body = backupIdRequestSchema.safeParse(request.body)
    if (!body.success) {
      reply.status(400).send(businessError('请求参数无效', request))
      return
    }
    const record = await getBackupById(body.data.backupId)
    if (!record) {
      reply.status(404).send(businessError('备份记录不存在', request, ErrorCode.BACKUP_NOT_FOUND))
      return
    }
    if (!isInsideBackupsRoot(record.filePath)) {
      reply.status(400).send(businessError('备份路径异常，已拒绝下载', request))
      return
    }
    if (!fs.existsSync(record.filePath)) {
      await updateBackupStatus(record.id, 'stale')
      reply.status(404).send(businessError('备份包文件已丢失', request, ErrorCode.BACKUP_FILE_MISSING))
      return
    }
    const fileName = path.basename(record.filePath)
    reply.header('Content-Type', record.kind === 'database' ? 'application/x-sqlite3' : 'application/gzip')
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
    reply.send(fs.createReadStream(record.filePath))
  })

  app.post('/app/instance/backup/delete', async (request): Promise<ApiSuccessResponse<BackupMutationResult> | ApiErrorResponse> => {
    const auth = await authorize(request)
    if (auth.error) {
      return auth.error
    }
    const body = backupIdRequestSchema.safeParse(request.body)
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const record = await getBackupById(body.data.backupId)
    if (!record) {
      return businessError('备份记录不存在', request, ErrorCode.BACKUP_NOT_FOUND)
    }
    // 与实例删除同序：先删记录再删文件，文件删除失败仅告警（记录已删，下次列表自然消失）
    await deleteBackupRecord(record.id)
    if (isInsideBackupsRoot(record.filePath) && fs.existsSync(record.filePath)) {
      try {
        fs.rmSync(record.filePath, { force: true })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : '删除备份文件失败'
        app.log.warn({ backupId: record.id, error: message }, '备份记录已删除，但文件清理失败，请手动处理')
      }
    }
    return success({ isSuccess: true, backupId: record.id }, request)
  })

  app.post('/app/instance/backup/restore', async (request): Promise<ApiSuccessResponse<BackupRestoreResult> | ApiErrorResponse> => {
    const auth = await authorize(request)
    if (auth.error) {
      return auth.error
    }
    const body = backupRestoreRequestSchema.safeParse(request.body)
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const record = await getBackupById(body.data.backupId)
    if (!record) {
      return businessError('备份记录不存在', request, ErrorCode.BACKUP_NOT_FOUND)
    }
    const instance = await getGameInstanceById(record.instanceId)
    if (!instance) {
      return businessError('实例不存在', request, ErrorCode.BACKUP_NOT_FOUND)
    }
    if (instance.status === 'running') {
      return businessError('实例运行中，必须先停止实例再恢复存档', request, ErrorCode.BACKUP_REQUIRES_STOPPED)
    }
    const result = await restoreInstanceBackup({ app, backupId: record.id })
    if (!result.ok) {
      return businessError(result.message ?? '恢复失败', request, ErrorCode.BACKUP_RESTORE_FAILED)
    }
    return success({
      isSuccess: true,
      safetyBackupId: result.safetyBackup?.id,
    }, request)
  })
  /** 探测本地目录可识别出的 DST 集群存档候选（只读，不落盘） */
  app.post('/app/instance/backup/import/probe', async (request): Promise<ApiSuccessResponse<SaveImportProbeResult> | ApiErrorResponse> => {
    const auth = await authorize(request)
    if (auth.error) {
      return auth.error
    }
    const body = saveImportProbeRequestSchema.safeParse(request.body)
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const probed = probeSaveImportSource(body.data.sourcePath)
    if (!probed.ok || !probed.result) {
      return businessError(probed.message ?? '源目录探测失败', request, ErrorCode.BACKUP_IMPORT_SOURCE_INVALID)
    }
    return success(probed.result, request)
  })
  /** 导入外部 Klei 集群存档到指定实例（要求实例已停止且已完成游戏安装） */
  app.post('/app/instance/backup/import', async (request): Promise<ApiSuccessResponse<SaveImportResult> | ApiErrorResponse> => {
    const auth = await authorize(request)
    if (auth.error) {
      return auth.error
    }
    const body = saveImportRequestSchema.safeParse(request.body)
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const result = await importSaveToInstance({
      app,
      instanceId: body.data.instanceId,
      sourceClusterPath: body.data.sourceClusterPath,
      clusterToken: body.data.clusterToken,
      createdBy: auth.operatorAccount,
    })
    if (!result.ok || !result.result) {
      return businessError(result.message ?? '存档导入失败', request, ErrorCode.BACKUP_IMPORT_FAILED)
    }
    return success(result.result, request)
  })
}
