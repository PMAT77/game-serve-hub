import { sanitizeSteamcmdLogLine } from '../../infra/container/steamcmd-errors'

/** 从 SteamCMD 单行输出解析下载进度百分比 */
export function parseSteamcmdProgressPercent(line: string): number | null {
  const bracketMatch = line.match(/\[\s*(\d{1,3})%\]/)
  if (bracketMatch) {
    return clampPercent(Number(bracketMatch[1]))
  }
  const progressMatch = line.match(/progress:\s*(\d+(?:\.\d+)?)/i)
  if (progressMatch) {
    return clampPercent(Math.round(Number(progressMatch[1])))
  }
  const normalizedMatch = line.match(/安装进度\s*(\d{1,3})\s*%/)
  if (normalizedMatch) {
    return clampPercent(Number(normalizedMatch[1]))
  }
  return null
}

function clampPercent(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** 写入/展示前规范化单行日志 */
export function normalizeInstallLogLine(line: string): string {
  return sanitizeSteamcmdLogLine(line.replace(/\r/g, ''))
}

/** 连续同阶段 Steam 进度行只保留最后一行，减少下载/校验刷屏 */
export function collapseRedundantSteamProgressLines(lines: string[]): string[] {
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

/** 将安装日志格式化为适合前端等宽展示的文本 */
export function formatInstallLogContent(raw: string): string {
  if (!raw.trim()) {
    return raw
  }
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => {
      const normalized = normalizeInstallLogLine(line)
      return normalized || line.trimEnd()
    })

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
