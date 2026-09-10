import type {
  BackupItem,
  BackupMutationResult,
  BackupRestoreResult,
  SaveImportCandidate,
  SaveImportProbeResult,
  SaveImportRequest,
  SaveImportResult,
  SaveImportTokenSource,
} from '../../../shared/contracts/backup'
import api from '../index'

export type {
  BackupItem,
  BackupMutationResult,
  BackupRestoreResult,
  SaveImportCandidate,
  SaveImportProbeResult,
  SaveImportRequest,
  SaveImportResult,
  SaveImportTokenSource,
}

export interface BackupDownloadOptions {
  backupId: string
}

export default {
  /** 创建实例存档备份（运行中实例会先发送 c_save() 热保存） */
  createBackup: (instanceId: string, note?: string) => api.post('app/instance/backup/create', {
    instanceId,
    ...(note?.trim() ? { note: note.trim() } : {}),
  }) as Promise<{ data: BackupMutationResult }>,
  /** 备份列表；instanceId 缺省返回全部（含数据库快照） */
  getBackupList: (instanceId?: string) => api.post('app/instance/backup/list', instanceId ? { instanceId } : {}) as Promise<{ data: BackupItem[] }>,
  /** 流式下载备份包 */
  downloadBackup: ({ backupId }: BackupDownloadOptions) => api.post('app/instance/backup/download', { backupId }, { responseType: 'blob' }) as Promise<{ data: Blob }>,
  deleteBackup: (backupId: string) => api.post('app/instance/backup/delete', { backupId }) as Promise<{ data: BackupMutationResult }>,
  /** 恢复实例存档（要求实例已停止；自动生成恢复前安全备份） */
  restoreBackup: (backupId: string) => api.post('app/instance/backup/restore', { backupId }) as Promise<{ data: BackupRestoreResult }>,
  /** 上传本地存档压缩包（zip/tar.gz）到服务端解压并识别集群候选；onProgress 回传 0-100 上传百分比 */
  uploadSaveImportArchive: (file: File, onProgress?: (percent: number) => void) => api.post(`app/instance/backup/import/upload?fileName=${encodeURIComponent(file.name)}`, file, {
    headers: { 'Content-Type': 'application/octet-stream' },
    timeout: 0,
    onUploadProgress: (event: { loaded: number, total?: number }) => {
      if (onProgress && event.total) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
    },
  }) as Promise<{ data: SaveImportProbeResult }>,
  /** 导入上传的外部 Klei 集群存档到指定实例（要求实例已停止且已完成游戏安装） */
  importSave: (data: SaveImportRequest) => api.post('app/instance/backup/import', data) as Promise<{ data: SaveImportResult }>,
  /** 创建面板数据库一致性快照（VACUUM INTO） */
  createDbBackup: () => api.post('app/system/db/backup', {}) as Promise<{ data: BackupMutationResult }>,
  /** 数据库快照列表 */
  getDbBackupList: () => api.get('app/system/db/backup') as Promise<{ data: BackupItem[] }>,
}
