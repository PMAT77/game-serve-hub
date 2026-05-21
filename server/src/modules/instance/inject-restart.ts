import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { businessError } from '../../shared/http/response'

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return typeof tokenHeader === 'string' ? tokenHeader : ''
}

/** 经 `/app/instance/restart` 执行停止后启动，并透传端口冲突等结构化错误 */
export async function injectRestartInstance(
  app: FastifyInstance,
  request: FastifyRequest,
  instanceId: string,
  options?: { autoAllocatePorts?: boolean },
): Promise<ApiErrorResponse | undefined> {
  const response = await app.inject({
    method: 'POST',
    url: '/app/instance/restart',
    headers: {
      token: normalizeToken(request.headers.token),
    },
    payload: {
      id: instanceId,
      ...(options?.autoAllocatePorts ? { autoAllocatePorts: true } : {}),
    },
  })
  if (response.statusCode >= 400) {
    return businessError('实例重启失败', request)
  }
  const payload = JSON.parse(response.body) as ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse
  if ('error' in payload && payload.error) {
    return businessError(
      payload.error,
      request,
      payload.code ?? ErrorCode.BUSINESS_RULE_VIOLATION,
      payload.data ?? {},
    )
  }
}
