import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const gameInstances = sqliteTable('game_instances', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull(),
  name: text('name').notNull(),
  gameCode: text('game_code').notNull(),
  status: text('status').notNull().default('stopped'),
  containerId: text('container_id'),
  runtimePid: integer('runtime_pid'),
  runtimeStartedAt: text('runtime_started_at'),
  installPath: text('install_path'),
  configPath: text('config_path'),
  queryPort: integer('query_port'),
  gamePort: integer('game_port'),
  rconPort: integer('rcon_port'),
  lastCommand: text('last_command'),
  lastExitCode: integer('last_exit_code'),
  lastError: text('last_error'),
  /** 最近一次异常退出检测时间（ISO）；成功启动后清除 */
  unexpectedExitAt: text('unexpected_exit_at'),
  installLogStatus: text('install_log_status'),
  installPercent: integer('install_percent'),
  installLogUpdatedAt: text('install_log_updated_at'),
  updateAvailable: integer('update_available').notNull().default(0),
  localBuildId: text('local_build_id'),
  remoteBuildId: text('remote_build_id'),
  updateCheckedAt: text('update_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const instanceMods = sqliteTable('instance_mods', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  workshopId: text('workshop_id').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull().default(0),
  loadOrder: integer('load_order').notNull().default(0),
  version: text('version'),
  previewImage: text('preview_image'),
  installStatus: text('install_status').notNull().default('ready'),
  installError: text('install_error'),
  config: text('config'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const backups = sqliteTable('backups', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  filePath: text('file_path').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  note: text('note').notNull().default(''),
  /** 备份来源：manual/scheduled/pre_update/pre_delete/pre_restore/database */
  kind: text('kind').notNull().default('manual'),
  /** completed=文件完整；failed=创建失败残留；stale=文件已丢失 */
  status: text('status').notNull().default('completed'),
  /** 打包时的分片结构快照（JSON 数组，如 ["master","caves"]），数据库快照为 null */
  shards: text('shards'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: text('created_at').notNull(),
})

export const instanceMaintenanceDrafts = sqliteTable('instance_maintenance_drafts', {
  instanceId: text('instance_id').primaryKey(),
  message: text('message').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
})

export const instanceMaintenancePushLogs = sqliteTable('instance_maintenance_push_logs', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  message: text('message').notNull(),
  operatorAccount: text('operator_account').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  pushedAt: text('pushed_at').notNull(),
})
