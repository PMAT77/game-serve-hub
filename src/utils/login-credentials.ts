const REMEMBER_KEY = 'login_remember'
const ACCOUNT_KEY = 'login_account'
// 历史版本曾把明文密码存进 localStorage（key: login_password），该行为存在凭据泄露风险，
// 已废弃；读取时顺带清除历史遗留值。
const LEGACY_PASSWORD_KEY = 'login_password'

export interface SavedLoginCredentials {
  account: string
  remember: boolean
}

export function readSavedLoginCredentials(): SavedLoginCredentials {
  localStorage.removeItem(LEGACY_PASSWORD_KEY)
  return {
    account: localStorage.getItem(ACCOUNT_KEY) ?? '',
    remember: localStorage.getItem(REMEMBER_KEY) === '1',
  }
}

export function saveLoginCredentials(values: {
  account: string
  remember: boolean
}) {
  // 只记住账号；密码交给浏览器密码管理器，绝不落 localStorage。
  if (values.remember) {
    localStorage.setItem(ACCOUNT_KEY, values.account)
    localStorage.setItem(REMEMBER_KEY, '1')
    return
  }
  localStorage.removeItem(ACCOUNT_KEY)
  localStorage.removeItem(REMEMBER_KEY)
}
