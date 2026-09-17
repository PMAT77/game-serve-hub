import { z } from 'zod'

export const nodeResourceSnapshotSchema = z.object({
  cpu: z.object({
    cores: z.number().int().positive(),
    usageRate: z.number().min(0).max(100),
    availableRate: z.number().min(0).max(100),
  }),
  memory: z.object({
    totalGb: z.number().nonnegative(),
    /** 已用 = 总量 − 可用；Linux 下的「可用」是 MemAvailable（含可回收的 page cache） */
    usedGb: z.number().nonnegative(),
    /** 可用内存（Linux 下为 MemAvailable），不是 MemFree —— 后者会把 page cache 算成已用 */
    freeGb: z.number().nonnegative(),
    usageRate: z.number().min(0).max(100),
  }),
  disk: z.object({
    totalGb: z.number().nonnegative(),
    usedGb: z.number().nonnegative(),
    freeGb: z.number().nonnegative(),
    usageRate: z.number().min(0).max(100),
  }),
})
export type NodeResourceSnapshot = z.infer<typeof nodeResourceSnapshotSchema>

export const nodeListItemSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string(),
  host: z.string(),
  sshPort: z.number().int().min(1).max(65535),
  status: z.enum(['online', 'offline']),
  resources: nodeResourceSnapshotSchema,
  lastHeartbeatAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type NodeListItem = z.infer<typeof nodeListItemSchema>
