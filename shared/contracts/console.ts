import { z } from 'zod'
import { instanceIdSchema } from './instance'

export { instanceIdSchema }

export const instanceConsoleCommandShardSchema = z.enum(['master', 'caves'])
export type InstanceConsoleCommandShard = z.infer<typeof instanceConsoleCommandShardSchema>

export const instanceConsoleLogFilterSchema = z.enum(['all', 'game', 'panel'])
export type InstanceConsoleLogFilter = z.infer<typeof instanceConsoleLogFilterSchema>

export const instanceConsoleLogStreamSchema = z.enum(['stdout', 'stderr', 'system'])
export type InstanceConsoleLogStream = z.infer<typeof instanceConsoleLogStreamSchema>

export const instanceConsoleLogShardSchema = z.enum(['master', 'caves'])
export type InstanceConsoleLogShard = z.infer<typeof instanceConsoleLogShardSchema>

export const instanceConsoleLogLineSchema = z.object({
  id: z.number().int().nonnegative(),
  stream: instanceConsoleLogStreamSchema,
  text: z.string(),
  at: z.string(),
  shard: instanceConsoleLogShardSchema.nullable().optional(),
})
export type InstanceConsoleLogLineDto = z.infer<typeof instanceConsoleLogLineSchema>

export const instanceConsoleShardStatusSchema = z.object({
  masterRunning: z.boolean(),
  cavesConfigured: z.boolean(),
  cavesRunning: z.boolean(),
})
export type InstanceConsoleShardStatus = z.infer<typeof instanceConsoleShardStatusSchema>

/** 直连命令展示档位：公网 / 本机 / 局域网 */
export const instanceConnectModeSchema = z.enum(['public', 'local', 'lan'])
export type InstanceConnectMode = z.infer<typeof instanceConnectModeSchema>

export const instanceConnectInfoSchema = z.object({
  running: z.boolean(),
  command: z.string(),
  localCommand: z.string(),
  lanCommand: z.string().nullable(),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  udpPorts: z.array(z.number().int().min(1).max(65535)),
  roomName: z.string(),
  networkMode: z.enum(['offline', 'lan_only', 'public']),
  networkModeLabel: z.string(),
  hasPassword: z.boolean(),
  hostSourceLabel: z.string(),
  isPlaceholder: z.boolean(),
  /** 面板推荐的默认展示档位：出站 IP 探测结果在本机/容器环境下往往不可直连 */
  preferredMode: instanceConnectModeSchema,
  hints: z.array(z.string()),
  consoleShards: instanceConsoleShardStatusSchema,
})
export type InstanceConnectInfoDto = z.infer<typeof instanceConnectInfoSchema>

export const instanceConsoleLogsPayloadSchema = z.object({
  lines: z.array(instanceConsoleLogLineSchema),
  running: z.boolean(),
})
export type InstanceConsoleLogsPayload = z.infer<typeof instanceConsoleLogsPayloadSchema>

export const consoleInstanceQuerySchema = z.object({
  instanceId: instanceIdSchema,
})

export const consoleLogsQuerySchema = consoleInstanceQuerySchema.extend({
  afterId: z.coerce.number().int().min(0).default(0),
  stream: instanceConsoleLogFilterSchema.default('all'),
})

export const consoleCommandBodySchema = consoleInstanceQuerySchema.extend({
  command: z.string().trim().min(1).max(4096),
  shard: instanceConsoleCommandShardSchema.default('master'),
})

export const consoleStreamTicketRequestSchema = consoleInstanceQuerySchema

export const consoleStreamTicketSchema = z.object({
  ticket: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
})
export type InstanceConsoleStreamTicketDto = z.infer<typeof consoleStreamTicketSchema>

export const consoleStreamQuerySchema = consoleInstanceQuerySchema.extend({
  streamTicket: z.string().trim().min(1),
})
