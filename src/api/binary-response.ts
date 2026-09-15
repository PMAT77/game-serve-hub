/**
 * 二进制下载响应的判定。
 *
 * 背景：下载类接口（控制台日志 / 备份 / 实例文件）用 `responseType: 'blob'`，
 * 成功时 `response.data` 是 Blob、不带业务信封的 `status` 字段。此前响应拦截器
 * 无条件按 `{ status: 1 | 0 }` 解读，Blob 会被判成「登录失效」并触发
 * `requestLogout()`，表现为「点下载就直接退出登录」。这里把判定抽成纯函数，
 * 便于单测覆盖。
 */
export interface BinaryResponseConfigShape {
  /** axios 请求配置里的 responseType */
  responseType?: string
}

/** 真正会返回二进制体的 responseType（json / text 仍走业务信封） */
const BINARY_RESPONSE_TYPES = new Set(['blob', 'arraybuffer'])

export function isBinaryResponse(
  config: BinaryResponseConfigShape | undefined,
  data: unknown,
): boolean {
  const responseType = config?.responseType
  if (typeof responseType === 'string' && BINARY_RESPONSE_TYPES.has(responseType)) {
    return true
  }
  // 兜底：个别适配器不回填 config.responseType，但响应体已经是 Blob
  return typeof Blob !== 'undefined' && data instanceof Blob
}

/**
 * 从二进制响应体里读回业务信封。
 *
 * 下载接口失败时后端仍返回 JSON 业务信封（HTTP 4xx + `{ status, error, code }`），
 * 但 `responseType: 'blob'` 会把它包成 Blob，中文原因就此丢失、界面只剩
 * 「Request failed with status code 404」。这里把 Blob 读成文本再解析回对象，
 * 让失败原因、强制改密与未授权判定都能按业务语义处理。
 *
 * 解析不出业务信封（响应体不是 JSON、为空、或本来就不是二进制响应）时返回
 * `undefined`，调用方保持原有的通用错误提示。
 */
export async function parseBinaryErrorPayload(data: unknown): Promise<Record<string, unknown> | undefined> {
  const text = await readResponseText(data)
  if (text === undefined) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  }
  catch {
    // 不是 JSON：交给调用方按通用错误处理
  }
  return undefined
}

/** Blob → 文本；已在文本形态时直接用；其它类型返回 undefined（说明不是二进制响应） */
async function readResponseText(data: unknown): Promise<string | undefined> {
  if (typeof data === 'string') {
    return data
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try {
      return await data.text()
    }
    catch {
      return undefined
    }
  }
  return undefined
}
