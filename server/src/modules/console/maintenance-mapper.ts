import type {
  InstanceMaintenanceAnnounceStateDto,
  InstanceMaintenanceDraftDto,
  InstanceMaintenancePushLogDto,
} from '../../../../shared/contracts/maintenance'
import type { DbMaintenanceDraft, DbMaintenancePushLog } from '../../shared/db/index'

export function toMaintenanceDraftDto(draft: DbMaintenanceDraft | undefined): InstanceMaintenanceDraftDto {
  return {
    message: draft?.message ?? '',
    updatedAt: draft?.updatedAt ?? null,
  }
}

export function toMaintenancePushLogDto(row: DbMaintenancePushLog): InstanceMaintenancePushLogDto {
  return {
    id: row.id,
    message: row.message,
    operatorAccount: row.operatorAccount,
    status: row.status,
    errorMessage: row.errorMessage,
    pushedAt: row.pushedAt,
  }
}

export function toMaintenanceAnnounceStateDto(
  draft: DbMaintenanceDraft | undefined,
  recentPushes: DbMaintenancePushLog[],
): InstanceMaintenanceAnnounceStateDto {
  return {
    draft: toMaintenanceDraftDto(draft),
    recentPushes: recentPushes.map(toMaintenancePushLogDto),
  }
}
