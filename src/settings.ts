import { setSettings } from '@fantastic-admin/settings'

export default setSettings({
  app: {
    account: {
      auth: true,
    },
    routeBaseOn: 'backend',
  },
  menu: {
    mainMenuClickMode: 'smart',
  },
  topbar: {
    tabbar: true,
    mode: 'fixed',
  },
  toolbar: {
    fullscreen: true,
    pageReload: true,
    colorScheme: true,
  },
})
