/**
 * 剥离 ANSI/CSI 转义。须先于 C0 控制符清理调用，避免 ESC 被删掉后残留 `[0m`。
 * 不处理 SteamCMD 进度方括号（如 `[  0%]`、`[----]`）。
 */
export function stripAnsiEscapes(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[@-Z\\-_]/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?m/g, '')
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?[GK]/g, '')
}

/** 去掉 Docker 多路复用流里偶发的控制字符，避免安装日志/错误信息乱码 */
export function sanitizeSteamcmdLogLine(line: string): string {
  return stripAnsiEscapes(line)
    .replace(/\uFEFF/g, '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/^[\u0001\u0002\u0003]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const DST_APP_ID = '343050'

function extractSteamcmdFailureSnippet(output: string): string {
  const sanitized = sanitizeSteamcmdLogLine(output) || output.trim()
  if (!sanitized) {
    return '（无 SteamCMD 输出）'
  }
  const lines = sanitized.split('\n').map(line => line.trim()).filter(Boolean)
  const errorLine = [...lines].reverse().find(line =>
    /error|failed|failure|missing|denied|timeout|invalid|not available|no subscription/i.test(line),
  )
  if (errorLine) {
    return errorLine
  }
  if (lines.length <= 3) {
    return lines.join(' | ')
  }
  return lines.slice(-3).join(' | ')
}

export function formatSteamcmdAppUpdateFailureMessage(input: {
  appId: string
  output: string
  mode: 'anonymous' | 'account'
  hasAccountCredentials: boolean
}): string {
  const output = sanitizeSteamcmdLogLine(input.output) || input.output.trim()
  const failureSnippet = extractSteamcmdFailureSnippet(input.output)
  const missingLicenseOrPerm = /Missing configuration|Missing file permissions/i.test(output)
  const isDst = input.appId.trim() === DST_APP_ID

  if (missingLicenseOrPerm && isDst && input.mode === 'anonymous' && !input.hasAccountCredentials) {
    return [
      'SteamCMD 安装 343050 失败（匿名不可用或目录权限不足）。',
      '饥荒联机版为 Steam 免费游戏，专用服务器通常需使用已入库该游戏的 Steam 账号登录安装（非 anonymous）。',
      '请在 panel.env / Compose 环境变量中配置 STEAMCMD_USERNAME、STEAMCMD_PASSWORD 后重试；',
      '账号需已在 Steam 库中加入「饥荒联机版」（免费）。',
      `SteamCMD 输出：${failureSnippet}`,
    ].join('')
  }

  if (missingLicenseOrPerm && isDst && input.mode === 'account') {
    return [
      '使用 Steam 账号登录后仍无法安装 343050（Missing configuration）。',
      '请确认：① 该账号库中已有饥荒联机版；② 未启用需令牌的非交互限制；③ 密码正确。',
      `SteamCMD 输出：${failureSnippet}`,
    ].join('')
  }

  return `安装失败（${input.mode}）：${failureSnippet}`
}
