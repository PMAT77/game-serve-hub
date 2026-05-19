import eventBus from '@/utils/eventBus'

/**
 * 展示「首次登录建议改密」通知（仅当登录接口返回 suggestPasswordChangeOnFirstLogin 时调用一次）。
 */
export function promptPasswordChangeIfNeeded() {
  const appAccountStore = useAppAccountStore()
  if (!appAccountStore.isLogin || !appAccountStore.suggestPasswordChangeOnFirstLogin) {
    return
  }

  appAccountStore.clearSuggestPasswordChangeOnFirstLogin()

  const toastId = faToast.warning('建议修改初始密码', {
    description: '为保障账号安全，请尽快在「个人设置 → 安全设置」中修改登录密码。',
    position: 'top-right',
    duration: 12_000,
    action: {
      label: '去修改',
      onClick: () => {
        faToast.dismiss(toastId)
        eventBus.emit('global-account-profile-open', { tab: 1 })
      },
    },
  })
}
