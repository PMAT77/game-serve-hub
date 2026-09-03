import type { FastifyInstance, FastifyRequest } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import {
  loginBodySchema,
  logoutBodySchema,
  passwordEditBodySchema,
  passwordRecoverBodySchema,
  refreshTokenBodySchema,
} from '../../../../shared/contracts/auth'
import type {
  LoginResponse,
  PasswordEditResponse,
  PasswordRecoveryStatusResponse,
  PermissionResponse,
  RefreshTokenResponse,
  SuccessResponse,
} from '../../../../shared/contracts/auth'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { deleteAdminCredentialsFile } from '../../shared/config/credentials-file'
import { loadServerConfig } from '../../shared/config'
import { resolveClientIp } from '../../shared/http/client-ip'
import { createSessionTokens, findPermissionsByUserId, findUserByAccount, findUserByToken, revokeSession, rotateSessionByRefreshToken, updateUserPassword, userMustChangePassword, verifyPassword } from '../../shared/db/index'
import { businessError, success, unauthorized } from '../../shared/http/response'
import type { MenuRouteItem } from '../../shared/menu-routes'
import { menuRouteList } from '../../shared/menu-routes'
import {
  clearLoginGuardState,
  getBlockRemainingSeconds,
  getLoginGuardState,
  isBlocked,
  issueCaptchaChallenge,
  recordLoginFailure,
  shouldRequireCaptcha,
  verifyCaptchaChallenge,
} from './login-guard'

interface PasswordChangeRateState {
  count: number
  windowStart: number
  blockedUntil: number
}

const PASSWORD_CHANGE_ATTEMPT_LIMIT = 5
const PASSWORD_CHANGE_WINDOW_MS = 10 * 60 * 1000
const PASSWORD_CHANGE_BLOCK_MS = 15 * 60 * 1000
const PASSWORD_CHANGE_MIN_INTERVAL_MS = 60 * 1000
const passwordChangeRateMap = new Map<string, PasswordChangeRateState>()
const PASSWORD_RECOVERY_ATTEMPT_LIMIT = 5
const PASSWORD_RECOVERY_WINDOW_MS = 15 * 60 * 1000
const passwordRecoveryRateMap = new Map<string, { count: number, windowStart: number }>()
const LOGIN_GUARD_OPTIONS = {
  maxFailures: 5,
  captchaThreshold: 3,
  windowMs: 5 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
  captchaTtlMs: 2 * 60 * 1000,
} as const

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return tokenHeader ?? ''
}

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const token = normalizeToken(request.headers.token)
  if (!token) {
    return undefined
  }
  return token
}

// 可信代理列表在进程内缓存一次（config 校验结果不随请求变化）。
let cachedTrustedProxies: string[] | undefined

function getTrustedProxies(): string[] {
  cachedTrustedProxies ??= loadServerConfig().trustedProxies
  return cachedTrustedProxies
}

function getClientIp(request: FastifyRequest): string {
  // 仅当 socket 对端命中 GSH_TRUST_PROXY 时才采信 X-Forwarded-For，
  // 防止伪造请求头绕过基于 IP 的登录限流。
  return resolveClientIp(request, getTrustedProxies())
}

function getLoginGuardKey(request: FastifyRequest, account: string): string {
  const ip = getClientIp(request)
  const normalizedAccount = account.trim().toLowerCase()
  return `${ip}:${normalizedAccount}`
}

function getLoginGuardKeys(request: FastifyRequest, account: string): string[] {
  const ip = getClientIp(request)
  // request.ip 是 TCP 对端地址，无法通过请求头伪造，作为兜底限流维度。
  const socketIp = request.ip || 'unknown'
  const normalizedAccount = account.trim().toLowerCase()
  return [
    `${ip}:${normalizedAccount}`,
    `ip:${ip}`,
    `socket:${socketIp}`,
    `account:${normalizedAccount}`,
  ]
}

function buildCaptchaRequiredResponse(
  request: FastifyRequest,
  loginGuardKey: string,
  message = '请先完成验证码验证',
): ApiErrorResponse {
  const challenge = issueCaptchaChallenge(loginGuardKey, LOGIN_GUARD_OPTIONS)
  return businessError(message, request, ErrorCode.CAPTCHA_REQUIRED, {
    captchaRequired: true,
    challengeToken: challenge.token,
    challengeQuestion: challenge.question,
    challengeExpiresInSec: challenge.expiresInSec,
  })
}

function isStrongPassword(password: string): boolean {
  // 至少 8 位，且包含大小写字母、数字与特殊字符。
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(password)
}

function verifyRecoveryToken(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }
  return timingSafeEqual(expectedBuffer, providedBuffer)
}

function checkPasswordRecoveryRateLimit(clientKey: string): string | undefined {
  const now = Date.now()
  const state = passwordRecoveryRateMap.get(clientKey)
  if (!state || now - state.windowStart > PASSWORD_RECOVERY_WINDOW_MS) {
    passwordRecoveryRateMap.set(clientKey, { count: 1, windowStart: now })
    return undefined
  }
  state.count += 1
  if (state.count > PASSWORD_RECOVERY_ATTEMPT_LIMIT) {
    return '找回密码尝试过于频繁，请稍后再试'
  }
  return undefined
}

function checkPasswordChangeRateLimit(userId: string): string | undefined {
  const now = Date.now()
  const state = passwordChangeRateMap.get(userId)
  if (!state) {
    return undefined
  }
  if (state.blockedUntil > now) {
    const waitMinutes = Math.ceil((state.blockedUntil - now) / 60_000)
    return `尝试过于频繁，请 ${waitMinutes} 分钟后再试`
  }
  if (now - state.windowStart > PASSWORD_CHANGE_WINDOW_MS) {
    passwordChangeRateMap.delete(userId)
  }
  return undefined
}

function recordPasswordChangeFailure(userId: string) {
  const now = Date.now()
  const state = passwordChangeRateMap.get(userId)
  if (!state || now - state.windowStart > PASSWORD_CHANGE_WINDOW_MS) {
    passwordChangeRateMap.set(userId, {
      count: 1,
      windowStart: now,
      blockedUntil: 0,
    })
    return
  }
  state.count += 1
  if (state.count >= PASSWORD_CHANGE_ATTEMPT_LIMIT) {
    state.blockedUntil = now + PASSWORD_CHANGE_BLOCK_MS
  }
  passwordChangeRateMap.set(userId, state)
}

function clearPasswordChangeFailures(userId: string) {
  passwordChangeRateMap.delete(userId)
}

/**
 * auth 模块注册入口
 * 负责认证、登录态、密码管理等能力。
 */
export function registerAuthModule(app: FastifyInstance) {
  app.get('/app/route/list', async (request): Promise<ApiSuccessResponse<MenuRouteItem[]>> => {
    return success(menuRouteList, request)
  })

  app.post('/app/account/login', async (request): Promise<ApiSuccessResponse<LoginResponse> | ApiErrorResponse> => {
    const parsed = loginBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return businessError('请求参数无效', request)
    }
    const body = parsed.data
    const account = body.account
    const password = body.password
    if (!account || !password) {
      return businessError('账号和密码不能为空', request)
    }
    const loginGuardKey = getLoginGuardKey(request, account)
    const loginGuardKeys = getLoginGuardKeys(request, account)
    const loginGuardStates = loginGuardKeys.map(key => getLoginGuardState(key, LOGIN_GUARD_OPTIONS))

    if (loginGuardStates.some(isBlocked)) {
      const retryAfterSec = Math.max(...loginGuardStates.map(getBlockRemainingSeconds))
      return businessError(
        `登录尝试过于频繁，请 ${Math.max(1, Math.ceil(retryAfterSec / 60))} 分钟后再试`,
        request,
        ErrorCode.LOGIN_RATE_LIMITED,
        { retryAfterSec },
      )
    }

    if (loginGuardStates.some(state => shouldRequireCaptcha(state, LOGIN_GUARD_OPTIONS))) {
      const captchaOk = verifyCaptchaChallenge(loginGuardKey, body.challengeToken, body.challengeAnswer)
      if (!captchaOk) {
        return buildCaptchaRequiredResponse(request, loginGuardKey)
      }
    }

    const user = await findUserByAccount(account)
    if (!user || !verifyPassword(password, user.password_hash)) {
      const nextStates = loginGuardKeys.map(key => recordLoginFailure(key, LOGIN_GUARD_OPTIONS))
      if (nextStates.some(isBlocked)) {
        const retryAfterSec = Math.max(...nextStates.map(getBlockRemainingSeconds))
        return businessError(
          `登录尝试过于频繁，请 ${Math.max(1, Math.ceil(retryAfterSec / 60))} 分钟后再试`,
          request,
          ErrorCode.LOGIN_RATE_LIMITED,
          { retryAfterSec },
        )
      }
      if (nextStates.some(state => shouldRequireCaptcha(state, LOGIN_GUARD_OPTIONS))) {
        return buildCaptchaRequiredResponse(request, loginGuardKey, '账号或密码错误，请完成验证码后再试')
      }
      return businessError('账号或密码错误', request)
    }
    loginGuardKeys.forEach(clearLoginGuardState)

    const remember = body.remember === true
    const tokens = await createSessionTokens(user.id, {
      remember,
      ip: getClientIp(request),
      userAgent: String(request.headers['user-agent'] ?? ''),
    })

    const mustChangePassword = userMustChangePassword(user)

    return success({
      account: user.account,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      avatar: user.avatar,
      email: user.email,
      remember,
      accessExpiresInSec: tokens.accessExpiresInSec,
      refreshExpiresInSec: tokens.refreshExpiresInSec,
      mustChangePassword,
    }, request)
  })

  app.post('/app/account/logout', async (request): Promise<ApiSuccessResponse<SuccessResponse> | ApiErrorResponse> => {
    const parsed = logoutBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return businessError('请求参数无效', request)
    }
    const body = parsed.data
    const token = getTokenByRequest(request)
    const refreshToken = body.refreshToken?.trim()
    if (!token) {
      return unauthorized(request)
    }
    await revokeSession(token)
    if (refreshToken) {
      await revokeSession(refreshToken)
    }
    return success({
      isSuccess: true,
    }, request)
  })

  app.post('/app/account/token/refresh', async (request): Promise<ApiSuccessResponse<RefreshTokenResponse> | ApiErrorResponse> => {
    const body = refreshTokenBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return unauthorized(request)
    }
    const refreshToken = body.data.refreshToken
    if (!refreshToken) {
      return unauthorized(request)
    }
    const rotated = await rotateSessionByRefreshToken(refreshToken, {
      ip: getClientIp(request),
      userAgent: String(request.headers['user-agent'] ?? ''),
    })
    if (!rotated) {
      return unauthorized(request)
    }
    return success({
      account: rotated.user.account,
      token: rotated.tokens.accessToken,
      refreshToken: rotated.tokens.refreshToken,
      avatar: rotated.user.avatar,
      email: rotated.user.email,
      accessExpiresInSec: rotated.tokens.accessExpiresInSec,
      refreshExpiresInSec: rotated.tokens.refreshExpiresInSec,
      mustChangePassword: userMustChangePassword(rotated.user),
    }, request)
  })

  app.get('/app/account/permission', async (request): Promise<ApiSuccessResponse<PermissionResponse> | ApiErrorResponse> => {
    const token = getTokenByRequest(request)
    if (!token) {
      return unauthorized(request)
    }

    const user = await findUserByToken(token)
    if (!user) {
      return unauthorized(request)
    }

    return success({
      permissions: await findPermissionsByUserId(user.id),
      mustChangePassword: userMustChangePassword(user),
    }, request)
  })

  app.post('/app/account/password/edit', async (request): Promise<ApiSuccessResponse<PasswordEditResponse> | ApiErrorResponse> => {
    const token = getTokenByRequest(request)
    if (!token) {
      return unauthorized(request)
    }

    const user = await findUserByToken(token)
    if (!user) {
      return unauthorized(request)
    }
    const changeRateLimitError = checkPasswordChangeRateLimit(user.id)
    if (changeRateLimitError) {
      return businessError(changeRateLimitError, request)
    }

    const body = passwordEditBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const password = body.data.password
    const newPassword = body.data.newPassword

    if (!password || !newPassword) {
      return businessError('原密码和新密码不能为空', request)
    }
    if (!isStrongPassword(newPassword)) {
      return businessError('新密码必须为 8-64 位，且包含大小写字母、数字和特殊字符', request)
    }
    if (newPassword === password) {
      return businessError('新密码不能与原密码相同', request)
    }
    if (!verifyPassword(password, user.password_hash)) {
      recordPasswordChangeFailure(user.id)
      return businessError('原密码错误', request)
    }
    const forcingPasswordChange = userMustChangePassword(user)
    const lastUpdatedMs = Date.parse(user.updated_at)
    if (
      !forcingPasswordChange
      && !Number.isNaN(lastUpdatedMs)
      && Date.now() - lastUpdatedMs < PASSWORD_CHANGE_MIN_INTERVAL_MS
    ) {
      return businessError('密码修改过于频繁，请稍后再试', request)
    }

    await updateUserPassword(user.id, newPassword, {
      keepSessions: forcingPasswordChange,
    })
    clearPasswordChangeFailures(user.id)
    if (forcingPasswordChange) {
      // 初始密码已被替换，清理启动阶段写入的 0600 初始凭据文件。
      deleteAdminCredentialsFile(loadServerConfig().dbPath)
    }

    return success({
      isSuccess: true,
      mustChangePassword: false,
    }, request)
  })

  app.get('/app/account/password/recovery-status', async (request): Promise<ApiSuccessResponse<PasswordRecoveryStatusResponse> | ApiErrorResponse> => {
    const configuredToken = loadServerConfig().passwordRecoveryToken
    return success({
      enabled: configuredToken.length >= 16,
      hint: configuredToken.length >= 16
        ? '已在服务器配置找回口令，请输入后设置新密码。'
        : null,
    }, request)
  })

  app.post('/app/account/password/recover', async (request): Promise<ApiSuccessResponse<SuccessResponse> | ApiErrorResponse> => {
    const configuredToken = loadServerConfig().passwordRecoveryToken
    if (configuredToken.length < 16) {
      return businessError('当前未启用在线找回密码，请通过服务器命令行重置', request)
    }

    const body = passwordRecoverBodySchema.safeParse(request.body ?? {})
    if (!body.success) {
      return businessError('请求参数无效', request)
    }
    const account = body.data.account
    const recoveryToken = body.data.recoveryToken
    const newPassword = body.data.newPassword
    const clientKey = `recover:${getClientIp(request)}`

    const rateLimitError = checkPasswordRecoveryRateLimit(clientKey)
    if (rateLimitError) {
      return businessError(rateLimitError, request)
    }

    if (!account || !recoveryToken || !newPassword) {
      return businessError('账号、找回口令和新密码不能为空', request)
    }
    if (!isStrongPassword(newPassword)) {
      return businessError('新密码必须为 8-64 位，且包含大小写字母、数字和特殊字符', request)
    }
    if (!verifyRecoveryToken(configuredToken, recoveryToken)) {
      return businessError('找回口令错误', request)
    }

    const user = await findUserByAccount(account)
    if (!user) {
      return businessError('账号不存在', request)
    }

    await updateUserPassword(user.id, newPassword)
    return success({ isSuccess: true }, request)
  })
}
