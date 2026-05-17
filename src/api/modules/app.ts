import api from '../index'

export default {
  // 后端获取路由数据
  routeList: () => api.get('app/route/list'),

  // 登录
  login: (data: {
    account: string
    password: string
    remember?: boolean
  }) => api.post('app/account/login', data),

  // 登出
  logout: () => api.post('app/account/logout'),

  // 获取权限
  permission: () => api.get('app/account/permission'),

  // 修改密码
  passwordEdit: (data: {
    password: string
    newPassword: string
  }) => api.post('app/account/password/edit', data),

}
