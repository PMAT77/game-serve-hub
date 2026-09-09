export function useAppMenu() {
  const router = useRouter()

  const appSettingsStore = useAppSettingsStore()
  const appMenuStore = useAppMenuStore()

  function generateTitle(title: string | (() => any) = '[ 无标题 ]') {
    return typeof title === 'function'
      ? title()
      : title
  }

  function switchTo(index: number) {
    // 点击当前已激活模块时不强制跳转模块首页：避免把详情页等隐藏路由页面（不在菜单路径上）
    // 甩回列表页（如实例详情页点击主导航「实例管理」会被重定向到实例列表）
    const isSwitchingModule = index !== appMenuStore.actived
    appMenuStore.setActived(index)
    if (
      isSwitchingModule
      && (appSettingsStore.settings.menu.mainMenuClickMode === 'jump'
        || (appSettingsStore.settings.menu.mainMenuClickMode === 'smart' && appMenuStore.sidebarMenusHasOnlyMenu))
    ) {
      router.push(appMenuStore.sidebarMenusFirstDeepestPath)
    }
  }

  return {
    generateTitle,
    switchTo,
  }
}
