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
    "mainMenuClickMode": "smart"
  },
  "topbar": {
    "tabbar": true,
    "mode": "fixed"
  },
  "tabbar": {
    "icon": true
  },
  "toolbar": {
    "fullscreen": true,
    "pageReload": true,
    "colorScheme": true
  }
})
