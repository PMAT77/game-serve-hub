import type {
  LoginBody,
  LoginResponse,
  LogoutBody,
  PasswordEditBody,
  PasswordEditResponse,
  PasswordRecoverBody,
  PasswordRecoveryStatusResponse,
  PermissionResponse,
  RefreshTokenBody,
  RefreshTokenResponse,
  SuccessResponse,
} from '../../../shared/contracts/auth'
import api from '../index'

export type {
  LoginBody,
  LoginResponse,
  LogoutBody,
  PasswordEditBody,
  PasswordEditResponse,
  PasswordRecoverBody,
  PasswordRecoveryStatusResponse,
  PermissionResponse,
  RefreshTokenBody,
  RefreshTokenResponse,
}

export default {
  routeList: () => api.get('app/route/list'),
  login: (data: LoginBody) => api.post('app/account/login', data) as Promise<{ data: LoginResponse }>,
  logout: (data?: LogoutBody) => api.post('app/account/logout', data ?? {}) as Promise<{ data: SuccessResponse }>,
  refreshToken: (data: RefreshTokenBody) => api.post('app/account/token/refresh', data, {
    skipAuthRefresh: true,
  }) as Promise<{ data: RefreshTokenResponse }>,
  permission: () => api.get('app/account/permission') as Promise<{ data: PermissionResponse }>,
  passwordEdit: (data: PasswordEditBody) => api.post('app/account/password/edit', data) as Promise<{ data: PasswordEditResponse }>,
  passwordRecoveryStatus: () => api.get('app/account/password/recovery-status') as Promise<{
    data: PasswordRecoveryStatusResponse
  }>,
  passwordRecover: (data: PasswordRecoverBody) => api.post('app/account/password/recover', data, {
    skipAuthRefresh: true,
  }) as Promise<{ data: SuccessResponse }>,
}
