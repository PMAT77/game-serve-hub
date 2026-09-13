/**
 * 解析前端访问后端 API 的基地址。
 *
 * 背景：生产构建依赖构建期的 VITE_APP_API_BASEURL。该变量只存在于 .env.production，
 * 而 .dockerignore 排除了 .env*，镜像构建因此拿到 undefined；此前调用方直接对该值
 * 调用 endsWith，运行到控制台 SSE 时抛 TypeError，实时日志静默失效（只剩轮询兜底）。
 * 这里统一取值并兜底为同源根路径，避免任何调用方再直接操作该变量。
 */
export interface ApiBaseUrlEnv {
  /** import.meta.env.DEV：是否为开发构建 */
  dev: boolean
  /** import.meta.env.VITE_ENABLE_PROXY：开发期是否走 Vite 代理 */
  proxyEnabled: unknown
  /** import.meta.env.VITE_APP_API_BASEURL：构建期注入的接口前缀 */
  configured: unknown
}

/** 同源根路径：前后端同域部署时的安全默认值 */
export const DEFAULT_API_BASE_URL = '/'

export function resolveApiBaseUrl(env: ApiBaseUrlEnv): string {
  if (env.dev && Boolean(env.proxyEnabled)) {
    return '/proxy/'
  }
  const configured = typeof env.configured === 'string' ? env.configured.trim() : ''
  return configured === '' ? DEFAULT_API_BASE_URL : configured
}

/** 归一化为带尾斜杠的前缀，供手工拼接 URL 的场景使用（如 SSE 地址） */
export function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}
