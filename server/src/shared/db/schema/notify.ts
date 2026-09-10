import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 通知渠道（Community：通用 Webhook / Telegram 承诺的最小可用子集先行——
 * 国内直连可达的钉钉/企微/飞书群机器人与 Server酱/PushPlus 个人推送）。
 */
export const notifyChannels = sqliteTable('notify_channels', {
  id: text('id').primaryKey(),
  /** dingtalk / wecom / feishu / serverchan / pushplus */
  type: text('type').notNull(),
  name: text('name').notNull(),
  /** JSON 序列化的渠道配置（webhookUrl/secret/sendKey 等），返回前端时脱敏 */
  config: text('config').notNull().default('{}'),
  enabled: integer('enabled').notNull().default(1),
  /** healthy / failing（连续失败熔断标记） */
  healthStatus: text('health_status').notNull().default('healthy'),
  lastErrorAt: text('last_error_at'),
  lastErrorMessage: text('last_error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
