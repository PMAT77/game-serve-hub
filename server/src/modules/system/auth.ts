import type { FastifyRequest } from 'fastify'
import type { ApiErrorResponse } from '../../../../shared/contracts/api'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { findPermissionsByUserId, findUserByToken, userMustChangePassword } from '../../shared/db/index'
import { businessError, unauthorized } from '../../shared/http/response'
import { normalizeRequestToken } from '../../shared/http/token'

const FORCE_PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/app/account/password/edit',
  '/app/account/logout',
  '/app/account/permission',
])

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const token = normalizeRequestToken(request.headers.token)
  if (!token) {
    return undefined
  }
  return token
}

interface AuthOptions {
  allowQueryToken?: boolean
}

export interface RequirePermissionOptions extends AuthOptions {
  permissions?: string | string[]
}

export interface AuthorizedUser {
  id: string
  account: string
}

export interface AuthorizedContext {
  token: string
  user: AuthorizedUser
  permissions: string[]
}

function resolveToken(request: FastifyRequest, options?: AuthOptions): string | undefined {
  const token = getTokenByRequest(request)
  if (token) {
    return token
  }
  if (!options?.allowQueryToken) {
    return undefined
  }
  const query = request.query as { token?: string }
  return query.token?.trim() || undefined
}

function normalizeRequiredPermissions(input: RequirePermissionOptions['permissions']): string[] {
  if (!input) {
    return []
  }
  if (Array.isArray(input)) {
    return input.map(item => item.trim()).filter(Boolean)
  }
  const value = input.trim()
  return value ? [value] : []
}

export async function resolveAuthorizedContext(
  request: FastifyRequest,
  options?: RequirePermissionOptions,
): Promise<{ error?: ApiErrorResponse, context?: AuthorizedContext }> {
  const token = resolveToken(request, options)
  if (!token) {
    return { error: unauthorized(request) }
  }
  const user = await findUserByToken(token)
  if (!user) {
    return { error: unauthorized(request) }
  }

  if (
    userMustChangePassword(user)
    && !FORCE_PASSWORD_CHANGE_ALLOWED_PATHS.has(request.url.split('?')[0] ?? '')
  ) {
    return {
      error: businessError(
        '首次登录须修改初始密码',
        request,
        ErrorCode.FORCE_PASSWORD_CHANGE,
        { mustChangePassword: true },
      ),
    }
  }

  const requiredPermissions = normalizeRequiredPermissions(options?.permissions)
  let permissions: string[] = []
  if (requiredPermissions.length > 0) {
    permissions = await findPermissionsByUserId(user.id)
    const permissionSet = new Set(permissions)
    const hasAllPermissions = requiredPermissions.every(permission => permissionSet.has(permission))
    if (!hasAllPermissions) {
      return {
        error: businessError('当前账号无权限执行该操作', request, ErrorCode.FORBIDDEN, {
          requiredPermissions,
        }),
      }
    }
  }

  return {
    context: {
      token,
      user: {
        id: user.id,
        account: user.account,
      },
      permissions,
    },
  }
}

export async function requirePermission(
  request: FastifyRequest,
  permissionsOrOptions?: string | string[] | RequirePermissionOptions,
  maybeOptions?: AuthOptions,
): Promise<ApiErrorResponse | undefined> {
  const options: RequirePermissionOptions
    = typeof permissionsOrOptions === 'string' || Array.isArray(permissionsOrOptions)
      ? {
          permissions: permissionsOrOptions,
          ...(maybeOptions ?? {}),
        }
      : (permissionsOrOptions ?? {})

  const auth = await resolveAuthorizedContext(request, options)
  if (auth.error) {
    return auth.error
  }
}

export async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  return requirePermission(request)
}
