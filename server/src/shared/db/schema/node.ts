import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const serverNodes = sqliteTable('server_nodes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  sshPort: integer('ssh_port').notNull().default(22),
  status: text('status').notNull().default('offline'),
  cpuUsage: real('cpu_usage').notNull().default(0),
  memoryUsage: real('memory_usage').notNull().default(0),
  diskUsage: real('disk_usage').notNull().default(0),
  lastHeartbeatAt: text('last_heartbeat_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
