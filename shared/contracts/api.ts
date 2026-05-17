import type { ErrorCodeValue } from '../constants/error-code'

export interface ApiSuccessResponse<T> {
  status: 1
  error: ''
  code: ErrorCodeValue
  data: T
  requestId?: string
}

export interface ApiErrorResponse {
  status: 1 | 0
  error: string
  code: ErrorCodeValue
  data: Record<string, never>
  requestId?: string
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse
