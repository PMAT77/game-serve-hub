/** 实例维护公告草稿 */
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
