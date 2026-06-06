import apiApp from '@/api/modules/app'
import router from '@/router'

export const useAppAccountStore = defineStore('appAccount', () => {
  const appSettingsStore = useAppSettingsStore()
  const appTabbarStore = useAppTabbarStore()
  const appRouteStore = useAppRouteStore()
  const appMenuStore = useAppMenuStore()

  function getPersistentStorage(remember: boolean) {
    return remember ? localStorage : sessionStorage
  }

  function readAccountStorageValue(key: string) {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key) ?? ''
  }

  function clearAccountStorage() {
    const keys = ['token', 'refreshToken', 'account', 'avatar', 'email', 'mustChangePassword']
    keys.forEach((key) => {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    })
  }

  function writeMustChangePasswordFlag(value: boolean, remember?: boolean) {
    const storage = getPersistentStorage(remember ?? Boolean(localStorage.getItem('account')))
    storage.setItem('mustChangePassword', value ? '1' : '0')
  }

  function readMustChangePasswordFlag(): boolean {
    return readAccountStorageValue('mustChangePassword') === '1'
  }

  // 账号信息
  const token = ref(readAccountStorageValue('token'))
  const refreshToken = ref(readAccountStorageValue('refreshToken'))
  const account = ref(readAccountStorageValue('account'))
  const avatar = ref(readAccountStorageValue('avatar'))
  const email = ref(readAccountStorageValue('email'))

  // 权限信息
  const permissions = ref<string[]>([])
  /** 服务端要求强制改密：未完成前仅可访问改密页 */
  const mustChangePassword = ref(readMustChangePasswordFlag())
  /** 仅本次登录：服务端在「首次登录」时返回 true，用于右上角改密建议（与 DB 长期标记无关） */
  const suggestPasswordChangeOnFirstLogin = ref(false)

  // 登录状态
  const isLogin = computed(() => {
    if (token.value && refreshToken.value) {
      return true
    }
    return false
  })

  // 登录
  async function login(data: {
    account: string
    password: string
    remember?: boolean
    challengeToken?: string
    challengeAnswer?: string
  }) {
    const remember = data.remember === true
    const res = await apiApp.login({
      account: data.account,
      password: data.password,
      remember,
      challengeToken: data.challengeToken,
      challengeAnswer: data.challengeAnswer,
    })
    const targetStorage = getPersistentStorage(remember)
    clearAccountStorage()
    targetStorage.setItem('account', res.data.account)
    targetStorage.setItem('token', res.data.token)
    targetStorage.setItem('refreshToken', res.data.refreshToken)
    targetStorage.setItem('avatar', res.data.avatar)
    targetStorage.setItem('email', res.data.email)
    account.value = res.data.account
    token.value = res.data.token
    refreshToken.value = res.data.refreshToken
    avatar.value = res.data.avatar
    email.value = res.data.email
    mustChangePassword.value = res.data.mustChangePassword === true
    writeMustChangePasswordFlag(mustChangePassword.value, remember)
    suggestPasswordChangeOnFirstLogin.value = false
  }

  function applySessionTokens(payload: {
    token: string
    refreshToken: string
  }) {
    const refresh = payload.refreshToken?.trim() ?? ''
    token.value = payload.token
    refreshToken.value = refresh
    if (!payload.token || !refresh) {
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      sessionStorage.removeItem('token')
      sessionStorage.removeItem('refreshToken')
      return
    }
    if (localStorage.getItem('account')) {
      localStorage.setItem('token', payload.token)
      localStorage.setItem('refreshToken', refresh)
      return
    }
    sessionStorage.setItem('token', payload.token)
    sessionStorage.setItem('refreshToken', refresh)
  }

  function clearSuggestPasswordChangeOnFirstLogin() {
    suggestPasswordChangeOnFirstLogin.value = false
  }

  function setMustChangePassword(value: boolean) {
    mustChangePassword.value = value
    writeMustChangePasswordFlag(value)
  }

  // 手动登出
  async function logout(redirect = router.currentRoute.value.fullPath) {
    if (token.value) {
      await apiApp.logout({
        refreshToken: refreshToken.value || undefined,
      }).catch(() => {})
    }
    clearAccountStorage()
    token.value = ''
    refreshToken.value = ''
    router.push({
      name: 'login',
      query: {
        ...(redirect !== appSettingsStore.settings.app.home.fullPath && router.currentRoute.value.name !== 'login' && { redirect }),
      },
    }).then(logoutCleanStatus)
  }

  // 请求登出
  function requestLogout() {
    clearAccountStorage()
    token.value = ''
    refreshToken.value = ''
    router.push({
      name: 'login',
      query: {
        ...(
          router.currentRoute.value.fullPath !== appSettingsStore.settings.app.home.fullPath
          && router.currentRoute.value.name !== 'login'
          && {
            redirect: router.currentRoute.value.fullPath,
          }
        ),
      },
    }).then(logoutCleanStatus)
  }

  // 登出后清除状态
  function logoutCleanStatus() {
    clearAccountStorage()
    account.value = ''
    refreshToken.value = ''
    avatar.value = ''
    email.value = ''
    permissions.value = []
    mustChangePassword.value = false
    suggestPasswordChangeOnFirstLogin.value = false
    appSettingsStore.updateSettings({}, true)
    appTabbarStore.clean()
    appRouteStore.removeRoutes()
    appMenuStore.setActived(0)
  }

  // 获取权限
  async function getPermissions() {
    const res = await apiApp.permission()
    permissions.value = res.data.permissions
    mustChangePassword.value = res.data.mustChangePassword === true
    writeMustChangePasswordFlag(mustChangePassword.value)
  }

  // 修改密码
  async function editPassword(data: {
    password: string
    newPassword: string
  }) {
    await apiApp.passwordEdit(data)
    mustChangePassword.value = false
    writeMustChangePasswordFlag(false)
    clearSuggestPasswordChangeOnFirstLogin()
  }

  // 锁屏
  function lock() {
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('refreshToken')
  }

  // 解锁
  function unlock() {
    if (localStorage.getItem('account')) {
      localStorage.setItem('token', token.value)
      localStorage.setItem('refreshToken', refreshToken.value)
      return
    }
    sessionStorage.setItem('token', token.value)
    sessionStorage.setItem('refreshToken', refreshToken.value)
  }

  return {
    token,
    refreshToken,
    account,
    avatar,
    email,
    permissions,
    mustChangePassword,
    suggestPasswordChangeOnFirstLogin,
    isLogin,
    login,
    applySessionTokens,
    logout,
    requestLogout,
    getPermissions,
    editPassword,
    clearSuggestPasswordChangeOnFirstLogin,
    setMustChangePassword,
    lock,
    unlock,
  }
})
