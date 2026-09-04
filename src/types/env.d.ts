/// <reference types="vite/client" />
interface ImportMetaEnv {
  // Auto generate by env-parse
  /**
   * 网络请求地址，应用于 axios 的 baseURL
   */
  readonly VITE_APP_API_BASEURL: string
  /**
   * 调试工具，可设置 eruda 或 vconsole
   */
  readonly VITE_APP_DEBUG_TOOL: string
  /**
   * 应用配置面板
   */
  readonly VITE_APP_SETTING: boolean
  /**
   * localStorage/sessionStorage 前缀
   */
  readonly VITE_APP_STORAGE_PREFIX: string
  /**
   * 网站标题
   */
  readonly VITE_APP_TITLE: string
  /**
   * 开发环境登录页预填（仅 DEV 构建生效）
   */
  readonly VITE_DEV_LOGIN_ACCOUNT: string
  /**
   * 须加引号，否则 vite-plugin-env-parse 会解析为 number，导致登录表单校验失败
   */
  readonly VITE_DEV_LOGIN_PASSWORD: number
  /**
   * 启用代理
   */
  readonly VITE_ENABLE_PROXY: boolean
  /**
   * 启用 turbo console
   */
  readonly VITE_ENABLE_TURBO_CONSOLE: boolean
  /**
   * 启用 Vue 开发工具
   */
  readonly VITE_ENABLE_VUE_DEVTOOLS: boolean
  /**
   * 启动编辑器（vite-plugin-vue-devtools / unplugin-turbo-console）
   */
  readonly VITE_LAUNCH_EDITOR: string
  /**
   * 启用假数据（仅开发环境）
   */
  readonly VITE_USE_FAKE: boolean
  readonly VITE_DEV_WEB_PORT: number
}
