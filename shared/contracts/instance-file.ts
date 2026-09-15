import { z } from 'zod'
import { instanceIdSchema } from './instance'

/** 实例目录内的相对路径（API 与界面统一用相对路径，不暴露宿主绝对路径） */
export const instanceRelativePathSchema = z.string().max(1024)

/** 面板内可编辑的文本类型；前后端共用同一份清单，避免界面允许编辑而后端拒绝 */
export const INSTANCE_EDITABLE_TEXT_EXTENSIONS = [
  'ini',
  'lua',
  'json',
  'txt',
  'cfg',
  'conf',
  'xml',
  'yaml',
  'yml',
  'md',
  'csv',
  'log',
] as const

export function isEditableInstanceFilePath(filePath: string): boolean {
  const match = /\.([A-Za-z0-9]+)$/.exec(filePath.trim())
  if (!match) {
    return false
  }
  return (INSTANCE_EDITABLE_TEXT_EXTENSIONS as readonly string[]).includes(match[1]!.toLowerCase())
}

export const instanceFileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(['file', 'directory']),
  sizeBytes: z.number().int().nonnegative(),
  /** 最后修改时间（ISO）；读不到为空串 */
  modifiedAt: z.string(),
  /** 敏感文件：可以列出，但不提供内容查看、写入、重命名与删除 */
  protected: z.boolean(),
})
export type InstanceFileEntry = z.infer<typeof instanceFileEntrySchema>

export const instanceFileListQuerySchema = z.object({
  instanceId: instanceIdSchema,
  /** 省略或空串表示实例目录根 */
  path: instanceRelativePathSchema.optional(),
})
export type InstanceFileListQuery = z.infer<typeof instanceFileListQuerySchema>

export const instanceFileListSchema = z.object({
  instanceId: instanceIdSchema,
  path: z.string(),
  entries: z.array(instanceFileEntrySchema),
})
export type InstanceFileListDto = z.infer<typeof instanceFileListSchema>

export const instanceFileContentQuerySchema = z.object({
  instanceId: instanceIdSchema,
  path: z.string().min(1).max(1024),
})
export type InstanceFileContentQuery = z.infer<typeof instanceFileContentQuerySchema>

export const instanceFileContentSchema = z.object({
  instanceId: instanceIdSchema,
  path: z.string(),
  content: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** 文件大于读取上限时只返回前一段内容 */
  truncated: z.boolean(),
  modifiedAt: z.string(),
})
export type InstanceFileContentDto = z.infer<typeof instanceFileContentSchema>

export const instanceFileWritePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  path: z.string().min(1).max(1024),
  content: z.string(),
})
export type InstanceFileWritePayload = z.infer<typeof instanceFileWritePayloadSchema>

export const instanceFileWriteResultSchema = z.object({
  saved: z.literal(true),
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
})
export type InstanceFileWriteResult = z.infer<typeof instanceFileWriteResultSchema>

export const instanceFileDeletePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  path: z.string().min(1).max(1024),
})
export type InstanceFileDeletePayload = z.infer<typeof instanceFileDeletePayloadSchema>

export const instanceFileDeleteResultSchema = z.object({
  removed: z.boolean(),
  path: z.string(),
})
export type InstanceFileDeleteResult = z.infer<typeof instanceFileDeleteResultSchema>

export const instanceFileRenamePayloadSchema = z.object({
  instanceId: instanceIdSchema,
  path: z.string().min(1).max(1024),
  newName: z.string().trim().min(1).max(255),
})
export type InstanceFileRenamePayload = z.infer<typeof instanceFileRenamePayloadSchema>

export const instanceFileRenameResultSchema = z.object({
  path: z.string(),
})
export type InstanceFileRenameResult = z.infer<typeof instanceFileRenameResultSchema>
