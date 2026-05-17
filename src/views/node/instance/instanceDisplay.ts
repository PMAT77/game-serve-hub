import type { InstanceInstallLogPayload, InstanceInstallLogSource, InstanceItem, InstanceStatus } from '@/api/modules/instance'

/** 实例状态中文标签 */
export function getStatusLabel(status: InstanceStatus) {
  switch (status) {
    case 'pending_install':
      return '未安装'
    case 'running':
      return '运行中'
    case 'stopped':
      return '已停止'
    case 'installing':
      return '安装中'
    case 'error':
      return '异常'
  }
}

/** 实例状态徽章 UnoCSS 类名 */
export function getStatusBadgeClass(status: InstanceStatus) {
  switch (status) {
    case 'pending_install':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
    case 'running':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'stopped':
      return 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
    case 'installing':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
    case 'error':
      return 'bg-red-500/10 text-red-600 dark:text-red-300'
  }
}

/** 判断 lastCommand 是否为运行时启动命令（非安装日志） */
export function looksLikeRuntimeCommand(text: string | null | undefined) {
  if (!text?.trim()) {
    return false
  }
  return /\.(?:sh|bat|cmd)\b/i.test(text)
    || /\bdontstarve\b/i.test(text)
    || /\bdedicated_server\b/i.test(text)
}

/** 从实例状态与 lastCommand/lastError 解析安装阶段文案 */
export function resolveInstallPhase(instance: InstanceItem): string {
  const command = instance.lastCommand?.trim() ?? ''
  const error = instance.lastError?.trim() ?? ''
  const text = `${command}\n${error}`.trim()

  if (instance.status === 'error') {
    if (error.includes('安装失败') || command.includes('安装失败')) {
      return '安装失败'
    }
    return error ? '安装失败' : '安装异常'
  }

  if (!text) {
    return instance.status === 'pending_install' ? '等待安装' : '安装中'
  }
  if (text.includes('等待安装')) {
    return '等待安装'
  }
  if (text.includes('正在准备更新')) {
    return '准备更新'
  }
  if (text.includes('正在准备')) {
    return '准备安装'
  }
  if (text.includes('登录重试') || text.includes('账号登录')) {
    return '账号登录重试'
  }
  if (/安装进度\s*\d+%/.test(text) || /\[\s*\d+%\]/.test(text) || /update state/i.test(text) || /downloading/i.test(text)) {
    return '下载游戏'
  }
  if (text.includes('安装完成') || text.includes('启动脚本')) {
    return '生成启动脚本'
  }
  if (/\d{1,3}\s*%/.test(text)) {
    return '下载游戏'
  }
  if (instance.status === 'installing' || instance.status === 'pending_install') {
    return '安装处理中'
  }
  return '—'
}

/** 解析安装进度百分比，无则返回 null */
export function extractInstallProgressPercent(instance: InstanceItem): number | null {
  if (typeof instance.installPercent === 'number' && Number.isFinite(instance.installPercent)) {
    return Math.max(0, Math.min(100, instance.installPercent))
  }
  const sources = [instance.lastCommand, instance.lastError]
  for (const text of sources) {
    if (!text) {
      continue
    }
    const normalizedMatch = text.match(/安装进度\s*(\d{1,3})\s*%/)
    if (normalizedMatch) {
      return Math.max(0, Math.min(100, Number(normalizedMatch[1])))
    }
    const bracketMatch = text.match(/\[\s*(\d{1,3})%\]/)
    if (bracketMatch) {
      return Math.max(0, Math.min(100, Number(bracketMatch[1])))
    }
    const genericMatch = text.match(/(\d{1,3})\s*%/)
    if (genericMatch) {
      return Math.max(0, Math.min(100, Number(genericMatch[1])))
    }
  }
  return null
}

/** 是否应在安装列展示详细进度/阶段 */
export function shouldShowInstallDetail(instance: InstanceItem) {
  return instance.status === 'pending_install'
    || instance.status === 'installing'
    || instance.status === 'error'
}

/** 是否可打开 SteamCMD 安装日志弹窗 */
export function canOpenInstallLog(instance: InstanceItem) {
  if (instance.status === 'pending_install' || instance.status === 'installing' || instance.status === 'error') {
    return true
  }
  if (instance.lastError?.trim()) {
    return true
  }
  const command = instance.lastCommand?.trim()
  if (!command) {
    return false
  }
  if (looksLikeRuntimeCommand(command)) {
    return false
  }
  return command.includes('安装')
    || command.includes('Steam')
    || command.includes('steamcmd')
    || command.includes('脚本')
}

/** 安装日志数据来源中文 */
export function getInstallLogSourceLabel(source: InstanceInstallLogSource | undefined) {
  switch (source) {
    case 'install_log':
      return '完整 SteamCMD 输出'
    case 'status_summary':
      return '最近状态摘要（非完整日志）'
    case 'empty':
      return '暂无日志'
    default:
      return '未知'
  }
}

/** 安装日志接口状态中文 */
export function getInstallLogStatusLabel(status: InstanceInstallLogPayload['status'] | undefined) {
  switch (status) {
    case 'running':
      return '安装进行中'
    case 'success':
      return '安装成功'
    case 'failed':
      return '安装失败'
    case 'unknown':
      return '未知'
    default:
      return '未知'
  }
}

/** 是否为安装中状态（待安装 / 安装中） */
export function isInstanceInstallingStatus(status: InstanceStatus | undefined) {
  return status === 'pending_install' || status === 'installing'
}

/** 将轮询间隔毫秒转为用户可读刷新文案 */
export function formatPollIntervalHint(ms: number) {
  const seconds = Math.round(ms / 1000)
  return seconds >= 1 ? `每 ${seconds} 秒` : `每 ${ms} 毫秒`
}
