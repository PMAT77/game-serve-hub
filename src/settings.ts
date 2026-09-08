import { setSettings } from '@fantastic-admin/settings'

export default setSettings({
  "app": {
    "account": {
      "auth": true
    },
    "routeBaseOn": "backend",
    "dynamicTitle": true
  },
  "menu": {
    "mode": "single",
    "mainMenuClickMode": "smart"
  },
  "topbar": {
    "tabbar": true,
    "mode": "fixed"
  },
  "tabbar": {
    "icon": true,
    "memory": true
  },
  "toolbar": {
    "fullscreen": true,
    "pageReload": true,
    "colorScheme": true
  }
})
