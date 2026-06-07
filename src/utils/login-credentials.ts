const REMEMBER_KEY = 'login_remember'
const ACCOUNT_KEY = 'login_account'
const PASSWORD_KEY = 'login_password'

export interface SavedLoginCredentials {
  account: string
  password: string
  remember: boolean
}

export function readSavedLoginCredentials(): SavedLoginCredentials {
  const remember = localStorage.getItem(REMEMBER_KEY) === '1'
  return {
    account: localStorage.getItem(ACCOUNT_KEY) ?? '',
    password: remember ? (localStorage.getItem(PASSWORD_KEY) ?? '') : '',
    remember,
  }
}

export function saveLoginCredentials(values: {
  account: string
  password: string
  remember: boolean
}) {
  if (values.remember) {
    localStorage.setItem(ACCOUNT_KEY, values.account)
    localStorage.setItem(PASSWORD_KEY, values.password)
    localStorage.setItem(REMEMBER_KEY, '1')
    return
  }
  localStorage.removeItem(ACCOUNT_KEY)
  localStorage.removeItem(PASSWORD_KEY)
  localStorage.removeItem(REMEMBER_KEY)
}
