import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { getBackupById } from '../../shared/db/index'
import { closeDatabase } from '../../shared/db/connection'
import { loadServerConfig } from '../../shared/config'
import { resolveRepoRoot } from '../../shared/repo-root'
import { isInsideBackupsRoot } from '../backup/backup-ops'
import {
  createDatabaseSnapshot,
  formatTimestampForFile,
} from './db-snapshot-service'
import { verifyPanelDatabaseFile } from './db-snapshot-verify'

/**
 * 用面板数据库快照恢复面板数据。
 *
 * 为什么是「替换文件 + 退出进程」而不是进程内重开库：恢复后账号、会话、面板设置、实例记录
 * 全都换了一套，而调度器、实例状态对账、各模块缓存都还握着旧数据；重开一个连接不可能让
 * 这些内存态一起回到过去。退出进程由部署侧拉起（Docker 的 `restart: unless-stopped` 与
 * Native systemd 的 `Restart=on-failure`）是唯一干净的路径——**因此退出码必须非零**，
 * 正常退出不会被 systemd 拉起。
 *
 * 退路有两道：替换前给当前库 VACUUM 一份快照，替换下来的旧库改名留在原地。启动收尾
 * （`finalizePendingDatabaseRestore`）会校验恢复后的库，不通过就自动回退——否则面板会
 * 卡在「启动即崩」的重启循环里，而用户没有任何界面可用。
 */

/** 恢复标记文件名；放在数据库同目录，DB 与判据永远在同一处 */
const RESTORE_MARKER_NAME = '.db-restore-pending.json'

interface PendingRestoreMarker {
  /** 本次恢复使用的目标快照 id */
  targetBackupId: string
  /** 被替换下来的旧库路径（第一道退路） */
  replacedPath: string
  /** 恢复前的自动快照文件路径（第二道退路；文件可能已被保留策略淘汰） */
  preRestoreSnapshotPath: string | null
  at: string
}

/** server/drizzle 的绝对路径；bootstrap 与恢复流程共用同一处推导 */
export function resolveMigrationsFolder(): string {
  return path.resolve(resolveRepoRoot(), 'server/drizzle')
}

export function resolveRestoreMarkerPath(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), RESTORE_MARKER_NAME)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 恢复前确认目标目录放得下副本：快照在备份目录、主库在数据目录，两者在 Docker 下是
 * 不同卷，因此不能直接改名，必须先在同目录复制一份——这一步要占与快照等量的空间。
 * 查不到容量信息时放行：宁可让复制自己报错，也不要因为一个查询失败就拒绝恢复。
 */
function checkFreeSpace(dir: string, requiredBytes: number): { ok: boolean, message?: string } {
  try {
    const stat = fs.statfsSync(dir)
    const available = Number(stat.bsize) * Number(stat.bavail)
    const need = Math.ceil(requiredBytes * 1.2) + 1024 * 1024
    if (available < need) {
      return {
        ok: false,
        message: `磁盘空间不足：恢复需要约 ${formatBytes(need)}，当前可用 ${formatBytes(available)}`,
      }
    }
    return { ok: true }
  }
  catch {
    return { ok: true }
  }
}

export interface RestoreDatabaseResult {
  ok: boolean
  message?: string
  /** 恢复前自动快照的 id；恢复失败时不会产生 */
  preRestoreBackupId?: string
  replacedPath?: string
}

export interface RequestDatabaseRestoreOptions {
  app: FastifyInstance
  backupId: string
  createdBy: string
}

/**
 * 执行恢复的物理部分：关库 → 清 WAL 副文件 → 旧库改名让位 → 新库就位。
 * 抽成独立函数便于单测；调用方必须已写好恢复标记。
 */
export function swapDatabaseFile(input: { dbPath: string, preparedSourcePath: string, replacedPath: string }): void {
  closeDatabase()
  // WAL 副文件必须清掉：残留的 WAL 会盖在刚放回去的库上，得到的是两份数据的混合体
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${input.dbPath}${suffix}`, { force: true })
  }
  if (fs.existsSync(input.dbPath)) {
    fs.renameSync(input.dbPath, input.replacedPath)
  }
  fs.renameSync(input.preparedSourcePath, input.dbPath)
}

/**
 * 校验并准备一次恢复：只做检查与文件准备，不改动正在使用的数据库。
 * 返回的 preparedPath 需要调用方在写标记后交给 `swapDatabaseFile`。
 */
export async function requestDatabaseRestore(
  options: RequestDatabaseRestoreOptions,
): Promise<RestoreDatabaseResult> {
  const { app, backupId, createdBy } = options
  const record = await getBackupById(backupId)
  if (!record) {
    return { ok: false, message: '快照记录不存在' }
  }
  if (record.kind !== 'database') {
    return { ok: false, message: '这条记录不是面板数据库快照，不能用来恢复面板数据' }
  }
  if (!isInsideBackupsRoot(record.filePath)) {
    return { ok: false, message: '快照路径异常，已拒绝恢复' }
  }
  if (!fs.existsSync(record.filePath)) {
    return { ok: false, message: '快照文件已丢失，无法恢复' }
  }

  const migrationsFolder = resolveMigrationsFolder()
  const verified = verifyPanelDatabaseFile(record.filePath, migrationsFolder)
  if (!verified.ok) {
    return { ok: false, message: verified.message ?? '快照校验未通过' }
  }

  const dbPath = path.resolve(loadServerConfig().dbPath)
  let snapshotBytes = 0
  try {
    snapshotBytes = fs.statSync(record.filePath).size
  }
  catch {
    snapshotBytes = 0
  }
  const space = checkFreeSpace(path.dirname(dbPath), snapshotBytes)
  if (!space.ok) {
    return { ok: false, message: space.message }
  }

  // 第一道退路：当前库先 VACUUM 一份快照。这一步失败就中止——不允许没有退路的替换。
  const safety = await createDatabaseSnapshot(app, createdBy, {
    note: `恢复 ${formatTimestampForFile(new Date(record.createdAt))} 那份快照前的自动快照`,
  })
  if (!safety.ok || !safety.backupId) {
    return { ok: false, message: safety.message ?? '恢复前自动快照失败，已中止恢复' }
  }

  // 第二道退路与替换件：都落在数据库同目录，保证与主库同卷（跨卷 rename 会失败）
  const stamp = `${formatTimestampForFile(new Date())}-${Math.random().toString(36).slice(2, 6)}`
  const replacedPath = `${dbPath}.replaced-${stamp}`
  const preparedPath = `${dbPath}.restore-tmp`
  try {
    fs.copyFileSync(record.filePath, preparedPath)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `准备恢复文件失败：${message}` }
  }

  // 复制后再校验一次：跨卷复制出错或磁盘写坏都可能让副本与源不同，而它会成为新主库
  const preparedVerify = verifyPanelDatabaseFile(preparedPath, migrationsFolder)
  if (!preparedVerify.ok) {
    fs.rmSync(preparedPath, { force: true })
    return { ok: false, message: `恢复文件校验未通过：${preparedVerify.message ?? '未知原因'}` }
  }

  const marker: PendingRestoreMarker = {
    targetBackupId: backupId,
    replacedPath,
    preRestoreSnapshotPath: (await getBackupById(safety.backupId))?.filePath ?? null,
    at: new Date().toISOString(),
  }
  try {
    fs.writeFileSync(resolveRestoreMarkerPath(dbPath), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  }
  catch (error) {
    fs.rmSync(preparedPath, { force: true })
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `写入恢复标记失败，已中止恢复：${message}` }
  }

  try {
    swapDatabaseFile({ dbPath, preparedSourcePath: preparedPath, replacedPath })
  }
  catch (error) {
    // 主库此刻可能已经让位：标记还在，启动收尾会把旧库改回来
    const message = error instanceof Error ? error.message : String(error)
    app.log.error({ error: message, dbPath, replacedPath }, '恢复面板数据失败')
    return { ok: false, message: `替换数据库失败：${message}；面板重启后会自动回退到恢复前的数据` }
  }

  app.log.warn({ backupId, replacedPath, preRestoreBackupId: safety.backupId }, '面板数据已恢复，进程即将退出以加载新数据库')
  return { ok: true, preRestoreBackupId: safety.backupId, replacedPath }
}

/**
 * 启动收尾：上一次恢复是否成功。
 *
 * 面板启动早期（`initDatabase` 之前）调用。恢复后的库不可用时回退到恢复前的数据，
 * 并留下明确日志——这是「恢复坏库把面板变砖」的唯一防线。整个函数尽力而为：
 * 任何异常都只记日志，绝不阻止启动（否则面板会陷在重启循环里）。
 */
export async function finalizePendingDatabaseRestore(options: {
  app: FastifyInstance
  dbPath: string
  migrationsFolder: string
}): Promise<void> {
  const dbPath = path.resolve(options.dbPath)
  const markerPath = resolveRestoreMarkerPath(dbPath)
  let marker: PendingRestoreMarker | null = null
  try {
    if (!fs.existsSync(markerPath)) {
      return
    }
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as PendingRestoreMarker
  }
  catch (error) {
    options.app.log.warn({ error, markerPath }, '读取恢复标记失败，已忽略')
    fs.rmSync(markerPath, { force: true })
    return
  }
  if (!marker) {
    return
  }

  const verified = verifyPanelDatabaseFile(dbPath, options.migrationsFolder)
  if (verified.ok) {
    fs.rmSync(marker.replacedPath, { force: true })
    fs.rmSync(markerPath, { force: true })
    options.app.log.info(
      { targetBackupId: marker.targetBackupId, at: marker.at },
      '面板数据恢复完成，已清理恢复前的旧库',
    )
    return
  }

  options.app.log.error(
    { message: verified.message, targetBackupId: marker.targetBackupId },
    '恢复后的数据库不可用，正在回退到恢复前的数据',
  )
  const rolledBack = rollbackDatabase(dbPath, marker)
  fs.rmSync(markerPath, { force: true })
  if (rolledBack) {
    options.app.log.warn({ replacedPath: marker.replacedPath }, '已回退到恢复前的数据库，本次恢复未生效')
    return
  }
  options.app.log.error(
    { replacedPath: marker.replacedPath, preRestoreSnapshotPath: marker.preRestoreSnapshotPath },
    '回退失败：恢复前的数据库与自动快照都不可用，请按文档停机手动恢复',
  )
}

/** 回退：坏库挪开留证，先把旧库改回来，退而求其次用恢复前的自动快照 */
function rollbackDatabase(dbPath: string, marker: PendingRestoreMarker): boolean {
  try {
    if (fs.existsSync(dbPath)) {
      fs.renameSync(dbPath, `${dbPath}.broken-${Date.now()}`)
    }
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true })
    }
    if (marker.replacedPath && fs.existsSync(marker.replacedPath)) {
      fs.renameSync(marker.replacedPath, dbPath)
      return true
    }
    if (marker.preRestoreSnapshotPath && fs.existsSync(marker.preRestoreSnapshotPath)) {
      fs.copyFileSync(marker.preRestoreSnapshotPath, dbPath)
      return true
    }
    return false
  }
  catch {
    return false
  }
}
