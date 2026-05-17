import type { FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import { ErrorCode } from '../../../../shared/constants/error-code'

function getRequestId(request?: FastifyRequest): string | undefined {
  return request?.id
}

export function success<T>(data: T, request?: FastifyRequest): ApiSuccessResponse<T> {
  return {
    status: 1,
    error: '',
    code: ErrorCode.OK,
    data,
    requestId: getRequestId(request),
  }
}

export function businessError(
  message: string,
  request?: FastifyRequest,
  code: ApiErrorResponse['code'] = ErrorCode.BUSINESS_RULE_VIOLATION,
): ApiErrorResponse {
  return {
    status: 1,
    error: message,
    code,
    data: {},
    requestId: getRequestId(request),
  }
}

export function unauthorized(
  request?: FastifyRequest,
  message = '登录状态失效，请重新登录',
): ApiErrorResponse {
  return {
    status: 0,
    error: message,
    code: ErrorCode.UNAUTHORIZED,
    data: {},
    requestId: getRequestId(request),
  }
}
