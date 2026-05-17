import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const gameInstances = sqliteTable('game_instances', {
  id: text('id').primaryKey(),
  nodeId: text('node_id').notNull(),
  name: text('name').notNull(),
  gameCode: text('game_code').notNull(),
  status: text('status').notNull().default('stopped'),
  containerId: text('container_id'),
  runtimePid: integer('runtime_pid'),
  installPath: text('install_path'),
  configPath: text('config_path'),
  queryPort: integer('query_port'),
  gamePort: integer('game_port'),
  rconPort: integer('rcon_port'),
  lastCommand: text('last_command'),
  lastExitCode: integer('last_exit_code'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const instanceMods = sqliteTable('instance_mods', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  workshopId: text('workshop_id').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull().default(1),
  loadOrder: integer('load_order').notNull().default(0),
  version: text('version'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const backups = sqliteTable('backups', {
  id: text('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  filePath: text('file_path').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
})
