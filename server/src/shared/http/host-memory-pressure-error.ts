import type { FastifyRequest } from 'fastify'
import type { HostMemoryPressureFailure } from '../../infra/container/host-resource-guard'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { businessError } from './response'

export function hostMemoryPressureError(
  pressure: HostMemoryPressureFailure,
  request?: FastifyRequest,
) {
  return businessError(pressure.summary, request, ErrorCode.HOST_MEMORY_PRESSURE, { ...pressure.data })
}
