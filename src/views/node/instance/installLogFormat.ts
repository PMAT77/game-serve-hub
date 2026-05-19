/** 与后端 stripAnsiEscapes 对齐：剥离 ANSI，保留 SteamCMD `[  0%]` / `[----]` */
function stripAnsiEscapes(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B[@-Z\\-_]/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?m/g, '')
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?[GK]/g, '')
}

function normalizeInstallLogLine(line: string): string {
  return stripAnsiEscapes(line)
    .replace(/\uFEFF/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/^[\u0001\u0002\u0003]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trimEnd()
}

function collapseRedundantSteamProgressLines(lines: string[]): string[] {
  const result: string[] = []
  let lastProgressKey: string | null = null
  for (const line of lines) {
    const match = line.match(/Update state \((0x[0-9a-f]+)\) ([\w ]+)/i)
    if (match) {
      const key = `${match[1]}:${match[2].trim().toLowerCase()}`
      if (key === lastProgressKey && result.length > 0) {
        result[result.length - 1] = line
        continue
      }
      lastProgressKey = key
    }
    else {
      lastProgressKey = null
    }
    result.push(line)
  }
  return result
}

/** 前端展示用：规范化安装日志文本排版 */
export function formatInstallLogForDisplay(raw: string): string {
  if (!raw.trim()) {
    return raw
  }
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => normalizeInstallLogLine(line))

  const collapsedProgress = collapseRedundantSteamProgressLines(lines)

  const compact: string[] = []
  let previousBlank = false
  for (const line of collapsedProgress) {
    const isBlank = line.trim().length === 0
    if (isBlank && previousBlank) {
      continue
    }
    compact.push(line)
    previousBlank = isBlank
  }
  return compact.join('\n').trimEnd()
}
