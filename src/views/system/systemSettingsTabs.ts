/**
 * 「系统设置」模块的页内 tab 定义。
 *
 * 单独成一个模块，是为了让 `system-pages.test.ts` 能**直接 import** 它做校验
 * （tab 与设置页的 slot 是否一一对应），而不是拿正则去 grep 组件源码——
 * 那种写法改个格式就会假失败。
 *
 * 三个 tab 服务的是同一件事——**面板怎么运行、被谁用过**：面板自身的参数、
 * 它往哪儿发告警、以及谁在什么时候改了什么。
 *
 * 这三个 tab **没有各自的路由**：切 tab 只改组件内的一个 ref，地址栏不动、
 * 页面不重建（理由见 `SystemSettingsTabs.vue` 的注释）。
 *
 * 「插件」页的插件调用审计不在这里：那个记的是**插件**调用了宿主什么能力，
 * 与插件列表是同一个对象，留在插件页。
 */

export type SystemSettingsTabName = 'settings' | 'notify' | 'audit'

export interface SystemSettingsTab {
  /** 对应 `settings.vue` 里同名插槽 */
  name: SystemSettingsTabName
  label: string
}

export const SYSTEM_SETTINGS_TABS: SystemSettingsTab[] = [
  {
    name: 'settings',
    label: '面板设置',
  },
  {
    name: 'notify',
    label: '通知渠道',
  },
  {
    name: 'audit',
    label: '操作记录',
  },
]
