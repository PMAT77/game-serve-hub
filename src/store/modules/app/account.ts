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
    const keys = ['token', 'account', 'avatar', 'email']
    keys.forEach((key) => {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    })
  }

  // 账号信息
  const token = ref(readAccountStorageValue('token'))
  const account = ref(readAccountStorageValue('account'))
  const avatar = ref(readAccountStorageValue('avatar'))
  const email = ref(readAccountStorageValue('email'))

  // 权限信息
  const permissions = ref<string[]>([])
  /** 仅本次登录：服务端在「首次登录」时返回 true，用于右上角改密建议（与 DB 长期标记无关） */
  const suggestPasswordChangeOnFirstLogin = ref(false)

  // 登录状态
  const isLogin = computed(() => {
    if (token.value) {
      return true
    }
    return false
  })

  // 登录
  async function login(data: {
    account: string
    password: string
    remember?: boolean
  }) {
    const remember = data.remember === true
    const res = await apiApp.login({
      account: data.account,
      password: data.password,
      remember,
    })
    const targetStorage = getPersistentStorage(remember)
    clearAccountStorage()
    targetStorage.setItem('account', res.data.account)
    targetStorage.setItem('token', res.data.token)
    targetStorage.setItem('avatar', res.data.avatar)
    targetStorage.setItem('email', res.data.email)
    account.value = res.data.account
    token.value = res.data.token
    avatar.value = res.data.avatar
    email.value = res.data.email
    suggestPasswordChangeOnFirstLogin.value = res.data.mustChangePassword === true
  }

  function clearSuggestPasswordChangeOnFirstLogin() {
    suggestPasswordChangeOnFirstLogin.value = false
  }

  // 手动登出
  async function logout(redirect = router.currentRoute.value.fullPath) {
    if (token.value) {
      await apiApp.logout().catch(() => {})
    }
    clearAccountStorage()
    token.value = ''
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
    avatar.value = ''
    email.value = ''
    permissions.value = []
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
  }

  // 修改密码
  async function editPassword(data: {
    password: string
    newPassword: string
  }) {
    await apiApp.passwordEdit(data)
    clearSuggestPasswordChangeOnFirstLogin()
  }

  // 锁屏
  function lock() {
    localStorage.removeItem('token')
    sessionStorage.removeItem('token')
  }

  // 解锁
  function unlock() {
    if (localStorage.getItem('account')) {
      localStorage.setItem('token', token.value)
      return
    }
    sessionStorage.setItem('token', token.value)
  }

  return {
    token,
    account,
    avatar,
    email,
    permissions,
    suggestPasswordChangeOnFirstLogin,
    isLogin,
    login,
    logout,
    requestLogout,
    getPermissions,
    editPassword,
    clearSuggestPasswordChangeOnFirstLogin,
    lock,
    unlock,
  }
})
