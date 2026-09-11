import type { PanelUpdateStatus } from '@/api/modules/system'

type PanelImage = PanelUpdateStatus['image']
type UpdateKind = PanelUpdateStatus['updateKind']

export interface PanelUpdatePresentation {
  /** 版本主行，例如「当前版本：v0.2.2 · 已是最新」 */
  versionLine: string
  /** 有更新但当前部署方式不能在面板内更新时为 true */
  needsManualCommand: boolean
  /** 更新进行中或失败时的过程说明；没有进行中的更新且没有失败时为 null */
  phaseLine: string | null
  /** 上一次更新失败，需用户处理后重试 */
  updateFailed: boolean
}

/** 四种环境原因的解决办法完全一样，对用户只说一句 */
export const MANUAL_UPDATE_NOTE = '当前部署方式不支持面板内自动更新，请在服务器终端执行'

export const MANUAL_UPDATE_COMMAND = 'sudo gsh update'

export const MANUAL_UPDATE_HINT = '用安装脚本升级可恢复面板内一键更新。'

const PHASE_LINES: Record<PanelUpdateStatus['updatePhase'], string> = {
  idle: '',
  preparing: '正在检查本地镜像…',
  pulling: '正在下载镜像，请勿关闭面板…',
  recreating: '正在重建面板，约 30 秒后自动重连…',
  failed: '',
}

function resolveLocalVersion(image: PanelImage): string | null {
  const label = image.releaseVersion?.trim()
  if (label) {
    return label
  }
  const tag = image.tag?.trim()
  // latest 是可变标签，不能当作版本号展示。
  if (tag && tag !== 'latest') {
    return tag
  }
  return null
}

function buildVersionLine(version: string | null, suffix: string): string {
  return `当前版本：${version ?? '未知'} · ${suffix}`
}

/** 旧后端没有 updateKind 时退回按 updateAvailable 推断，避免误显示为「已是最新」 */
function resolveUpdateKind(status: PanelUpdateStatus, latestVersion: string | null): UpdateKind {
  if (status.updateKind) {
    return status.updateKind
  }
  if (!status.image.updateAvailable) {
    return 'none'
  }
  return latestVersion ? 'newer' : 'unknown'
}

/**
 * 过程说明：后端的 updateMessage 优先（它知道更细的情况，比如「本地已有镜像」），
 * 否则按阶段给一句通用文案；旧后端只有 updating 布尔值时退化为原提示。
 */
function resolvePhaseLine(status: PanelUpdateStatus): string | null {
  if (status.updatePhase === 'failed') {
    return status.updateError?.trim() || '更新失败，请稍后重试。'
  }
  if (!status.updatePhase || status.updatePhase === 'idle') {
    return status.updating ? '正在更新，面板稍后会自动重启…' : null
  }
  return status.updateMessage?.trim() || PHASE_LINES[status.updatePhase] || null
}

export function buildPanelUpdatePresentation(status: PanelUpdateStatus | null): PanelUpdatePresentation {
  if (!status) {
    return {
      versionLine: '',
      needsManualCommand: false,
      phaseLine: null,
      updateFailed: false,
    }
  }

  const image = status.image
  const version = resolveLocalVersion(image)
  const latestVersion = status.release?.tagName?.trim() || null
  const phaseLine = resolvePhaseLine(status)
  const updateFailed = status.updatePhase === 'failed'

  if (status.updating) {
    return {
      versionLine: buildVersionLine(version, '更新进行中'),
      needsManualCommand: false,
      phaseLine,
      updateFailed,
    }
  }

  let suffix = '已是最新'
  switch (resolveUpdateKind(status, latestVersion)) {
    case 'newer':
      suffix = latestVersion ? `有新版本 ${latestVersion}` : '有新版本'
      break
    case 'same-version-changed':
      suffix = '镜像内容有更新'
      break
    case 'unknown':
      suffix = '检测到镜像有更新'
      break
    case 'none':
    default:
      suffix = '已是最新'
      break
  }

  return {
    versionLine: buildVersionLine(version, suffix),
    needsManualCommand: image.updateAvailable && !status.imageApplySupported,
    phaseLine,
    updateFailed,
  }
}
