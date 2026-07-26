import type { DstInstanceSummariesDto } from '../../../shared/contracts/dst-summary'
import type { InstanceListQuery } from '../../../shared/contracts/instance'
import api from '../index'

export type { DstInstanceSummariesDto, DstInstanceSummaryDto, DstRoomSummaryDto, DstWorldSummaryDto } from '../../../shared/contracts/dst-summary'

export default {
  getDstInstanceSummaries: (data?: InstanceListQuery) => api.post('app/instance/dst-summaries', data) as Promise<{
    data: DstInstanceSummariesDto
  }>,
}
