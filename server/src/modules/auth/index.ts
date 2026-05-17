import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import { randomUUID } from 'node:crypto'
import { createSession, findPermissionsByUserId, findUserByAccount, findUserByToken, revokeSession, updateUserPassword, userMustChangePassword, verifyPassword } from '../../shared/db/index'
import { ErrorCode } from '../../../../shared/constants/error-code'
import { businessError, success, unauthorized } from '../../shared/http/response'
import type { RouteMetaRaw } from '../../../../packages/types/types'

/** 与前端 `vue-router` RouteMeta（RouteMetaRaw）对齐，避免后端菜单字段遗漏 */
type RouteMeta = RouteMetaRaw & {
  title: string
}

interface RouteItem {
  path?: string
  component?: string
  name?: string
  meta: RouteMeta
  children?: RouteItem[]
}

interface LoginBody {
  account: string
  password: string
  remember?: boolean
}

interface PasswordEditBody {
  password: string
  newPassword: string
}

interface PasswordChangeRateState {
  count: number
  windowStart: number
  blockedUntil: number
}

const NODE_INSTANCE_MANAGE_PERMISSION = 'pages.node.instance:manage'
const PASSWORD_CHANGE_ATTEMPT_LIMIT = 5
const PASSWORD_CHANGE_WINDOW_MS = 10 * 60 * 1000
const PASSWORD_CHANGE_BLOCK_MS = 15 * 60 * 1000
const PASSWORD_CHANGE_MIN_INTERVAL_MS = 60 * 1000
const passwordChangeRateMap = new Map<string, PasswordChangeRateState>()
const FORCE_PASSWORD_CHANGE_ALLOWLIST = new Set([
  '/app/account/login',
  '/app/account/logout',
  '/app/account/permission',
  '/app/account/password/edit',
])

const routeList: RouteItem[] = [
  {
    meta: {
      title: '控制台',
      icon: 'ri:dashboard-line',
    },
    children: [
      {
        path: '/console',
        component: 'Layout',
        name: 'console',
        meta: {
          title: '控制台',
          icon: 'ri:terminal-box-line',
        },
        children: [
          {
            path: 'monitor',
            name: 'consoleMonitor',
            component: 'console/monitor/index.vue',
            meta: {
              title: '监控台',
              icon: 'ri:pulse-line',
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '节点',
      icon: 'ri:server-line',
    },
    children: [
      {
        path: '/node',
        component: 'Layout',
        name: 'node',
        meta: {
          title: '节点管理',
          icon: 'ri:hard-drive-3-line',
          auth: NODE_INSTANCE_MANAGE_PERMISSION,
        },
        children: [
          {
            path: 'instance',
            name: 'nodeInstance',
            component: 'node/instance/index.vue',
            meta: {
              title: '实例管理',
              icon: 'ri:stack-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
            },
          },
          {
            path: 'instance/console/:instanceId',
            name: 'nodeInstanceConsole',
            component: 'node/instance/console.vue',
            meta: {
              title: '实例控制台',
              icon: 'ri:terminal-line',
              auth: NODE_INSTANCE_MANAGE_PERMISSION,
              activeMenu: '/node/instance',
              menu: false,
            },
          },
        ],
      },
    ],
  },
  {
    meta: {
      title: '系统',
      icon: 'ri:settings-3-line',
    },
    children: [
      {
        path: '/system',
        component: 'Layout',
        name: 'system',
        meta: {
          title: '系统管理',
          icon: 'ri:computer-line',
        },
        children: [
          {
            path: 'settings',
            name: 'systemSettings',
            component: 'system/settings.vue',
            meta: {
              title: '系统设置',
              icon: 'ri:settings-4-line',
            },
          },
        ],
      },
    ],
  },
]

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

function isStrongPassword(password: string): boolean {
  // 至少 8 位，且包含大小写字母、数字与特殊字符。
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,64}$/.test(password)
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
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/app/') || FORCE_PASSWORD_CHANGE_ALLOWLIST.has(path)) {
      return
    }

    const token = getTokenByRequest(request)
    if (!token) {
      return
    }

    const user = await findUserByToken(token)
    if (!user || !userMustChangePassword(user)) {
      return
    }

    reply.status(403).send(businessError(
      '请先修改初始密码后再使用其他功能',
      request,
      ErrorCode.FORCE_PASSWORD_CHANGE,
    ))
  })

  app.get('/app/route/list', async (request): Promise<ApiSuccessResponse<RouteItem[]>> => {
    return success(routeList, request)
  })

  app.post('/app/account/login', async (request): Promise<ApiSuccessResponse<{
    account: string
    token: string
    avatar: string
    email: string
  }> | ApiErrorResponse> => {
    const body = (request.body ?? {}) as Partial<LoginBody>
    const account = body.account?.trim() ?? ''
    const password = body.password ?? ''
    if (!account || !password) {
      return businessError('账号和密码不能为空', request)
    }

    const user = await findUserByAccount(account)
    if (!user || !verifyPassword(password, user.password_hash)) {
      return businessError('账号或密码错误', request)
    }

    const remember = body.remember === true
    const token = `${user.account}:${randomUUID()}`
    await createSession(token, user.id)

    return success({
      account: user.account,
      token,
      avatar: user.avatar,
      email: user.email,
      remember,
      mustChangePassword: userMustChangePassword(user),
    }, request)
  })

  app.post('/app/account/logout', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
    const token = getTokenByRequest(request)
    if (!token) {
      return unauthorized(request)
    }
    await revokeSession(token)
    return success({
      isSuccess: true,
    }, request)
  })

  app.get('/app/account/permission', async (request): Promise<ApiSuccessResponse<{
    permissions: string[]
  }> | ApiErrorResponse> => {
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

  app.post('/app/account/password/edit', async (request): Promise<ApiSuccessResponse<{
    isSuccess: boolean
  }> | ApiErrorResponse> => {
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

    const body = (request.body ?? {}) as Partial<PasswordEditBody>
    const password = body.password ?? ''
    const newPassword = body.newPassword ?? ''

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
    const lastUpdatedMs = Date.parse(user.updated_at)
    if (!Number.isNaN(lastUpdatedMs) && Date.now() - lastUpdatedMs < PASSWORD_CHANGE_MIN_INTERVAL_MS) {
      return businessError('密码修改过于频繁，请稍后再试', request)
    }

    await updateUserPassword(user.id, newPassword)
    clearPasswordChangeFailures(user.id)

    return success({
      isSuccess: true,
      mustChangePassword: false,
    }, request)
  })
}
