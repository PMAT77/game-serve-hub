import { z } from 'zod'

/**
 * 用户操作审计的对外契约。
 *
 * 记的是**面板操作者**做了什么：谁登录、谁重启了世界、谁删了备份。
 * 与插件调用审计（`plugin.ts` 里的 `pluginAuditRecordSchema`）分开定义：
 * 两者的主体、字段与保留策略都不同，合成一个类型只会让两边都别扭。
 */

export const operationAuditOutcomeSchema = z.enum(['ok', 'denied', 'error'])
export type OperationAuditOutcome = z.infer<typeof operationAuditOutcomeSchema>

export const operationAuditRecordSchema = z.object({
  id: z.number().int().positive(),
  at: z.string(),
  /** 操作账号；未认证或令牌失效时为 null（此时仍记，因为"谁在没登录时尝试写"本身就是线索） */
  account: z.string().nullable(),
  userId: z.string().nullable(),
  method: z.string(),
  /** 路由路径（不含查询串） */
  path: z.string(),
  /** 参数摘要（已剔除 token / password / secret 等敏感键） */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  statusCode: z.number().int(),
  /** ok=成功；denied=被拒（401/403，安全事件）；error=执行失败 */
  outcome: operationAuditOutcomeSchema,
  durationMs: z.number().int().nonnegative(),
  requestId: z.string(),
})
export type OperationAuditRecord = z.infer<typeof operationAuditRecordSchema>

export const operationAuditQuerySchema = z.object({
  account: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})
export type OperationAuditQuery = z.infer<typeof operationAuditQuerySchema>

export const operationAuditResultSchema = z.object({
  /** 审计文件所在目录，管理员排查时可以直接看原始 NDJSON */
  auditRoot: z.string(),
  records: z.array(operationAuditRecordSchema),
})
export type OperationAuditResult = z.infer<typeof operationAuditResultSchema>
