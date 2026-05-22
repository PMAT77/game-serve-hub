/** DST 维护公告 Lua 命令构建与校验 */

export const MAINTENANCE_ANNOUNCE_MAX_LENGTH = 500

export function escapeLuaDoubleQuotedString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

export function buildMaintenanceAnnounceCommand(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) {
    throw new Error('公告内容不能为空')
  }
  if (trimmed.length > MAINTENANCE_ANNOUNCE_MAX_LENGTH) {
    throw new Error(`公告内容不能超过 ${MAINTENANCE_ANNOUNCE_MAX_LENGTH} 个字符`)
  }
  return `TheNet:Announce("${escapeLuaDoubleQuotedString(trimmed)}")`
}

export function normalizeMaintenanceMessage(value: string | undefined): string {
  return value?.trim() ?? ''
}

export function validateMaintenanceMessage(message: string): string | undefined {
  if (!message) {
    return '公告内容不能为空'
  }
  if (message.length > MAINTENANCE_ANNOUNCE_MAX_LENGTH) {
    return `公告内容不能超过 ${MAINTENANCE_ANNOUNCE_MAX_LENGTH} 个字符`
  }
  return undefined
}
