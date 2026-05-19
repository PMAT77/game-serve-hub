import type { Router } from 'vue-router'
import { asyncRoutes } from './routes'

/**
 * 拉取权限、生成并注册动态路由（幂等）。登录成功或刷新后首次进入前调用，避免菜单首次跳转才注册路由。
 */
export async function ensureDynamicRoutes(router: Router) {
  const appRouteStore = useAppRouteStore()
  if (appRouteStore.isGenerate) {
    return
  }

  const appSettingsStore = useAppSettingsStore()
  const appAccountStore = useAppAccountStore()

  if (appSettingsStore.settings.app.account.auth) {
    await appAccountStore.getPermissions()
  }

  switch (appSettingsStore.settings.app.routeBaseOn) {
    case 'frontend':
      appRouteStore.generateRoutesAtFront(asyncRoutes)
      break
    case 'backend':
      await appRouteStore.generateRoutesAtBack()
      break
  }

  const removeRoutes: (() => void)[] = []
  appRouteStore.routes.forEach((route) => {
    if (!/^(?:https?:|mailto:|tel:)/.test(route.path)) {
      removeRoutes.push(router.addRoute(route))
    }
  })
  appRouteStore.systemRoutes.forEach((route) => {
    removeRoutes.push(router.addRoute(route))
  })
  appRouteStore.setCurrentRemoveRoutes(removeRoutes)
}
