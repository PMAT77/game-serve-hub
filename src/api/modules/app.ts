import api from '../index'

export default {
  // 后端获取路由数据
  routeList: () => api.get('app/route/list'),

  // 登录
  login: (data: {
    account: string
    password: string
    remember?: boolean
    challengeToken?: string
    challengeAnswer?: string
  }) => api.post('app/account/login', data),

  // 登出
  logout: (data?: { refreshToken?: string }) => api.post('app/account/logout', data ?? {}),

  // 刷新 token
  refreshToken: (data: { refreshToken: string }) => api.post('app/account/token/refresh', data, {
    skipAuthRefresh: true,
  }),

  // 获取权限
  permission: () => api.get('app/account/permission'),

  // 修改密码
  passwordEdit: (data: {
    password: string
    newPassword: string
  }) => api.post('app/account/password/edit', data),

}
