/** 实例维护公告草稿 */
import { z } from 'zod'
import { instanceIdSchema } from './instance'

export interface InstanceMaintenanceDraftDto {
  message: string
  updatedAt: string | null
}

/** 维护公告推送记录 */
export interface InstanceMaintenancePushLogDto {
  id: string
  message: string
  operatorAccount: string
  status: 'success' | 'failed'
  errorMessage: string | null
  pushedAt: string
}

/** GET /app/instance/maintenance/announce 响应体 */
export interface InstanceMaintenanceAnnounceStateDto {
  draft: InstanceMaintenanceDraftDto
  recentPushes: InstanceMaintenancePushLogDto[]
}

/** POST /app/instance/maintenance/announce/push 响应体 */
export interface InstanceMaintenancePushResultDto {
  isSuccess: boolean
  pushLog: InstanceMaintenancePushLogDto
  errorMessage?: string
}

export const maintenanceInstanceQuerySchema = z.object({
  instanceId: instanceIdSchema,
})
export type MaintenanceInstanceQuery = z.infer<typeof maintenanceInstanceQuerySchema>

export const maintenanceDraftPayloadSchema = z.object({
  instanceId: instanceIdSchema,
  message: z.string().trim().min(1).max(500),
})
export type MaintenanceDraftPayload = z.infer<typeof maintenanceDraftPayloadSchema>

export const maintenancePushPayloadSchema = z.object({
  instanceId: instanceIdSchema,
  message: z.string().trim().max(500).optional(),
})
export type MaintenancePushPayload = z.infer<typeof maintenancePushPayloadSchema>
