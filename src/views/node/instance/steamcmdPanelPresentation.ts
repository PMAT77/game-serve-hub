/**
 * 运行环境卡片（SteamcmdPanel）的展示决策。
 *
 * v0.2.0 起面板 / DST 运行环境 / SteamCMD 合并为同一统一镜像，默认部署下
 * steamcmdImage 与 gameDstImage 是同一个引用；面板一键更新还会把三者写成同一 tag
 * （见 server/src/modules/system/panel-update.ts）。因此这里把「同源合并、异构退化」
 * 的判断收敛到纯函数，模板只负责渲染。
 */

export type RuntimeEnvironmentTagType = 'success' | 'error' | 'warning' | 'default' | 'info'

export interface RuntimeEnvironmentInput {
  isNativeMode: boolean
  runtimeAvailable: boolean
  steamcmdInstalled: boolean
  gameDstInstalled: boolean
  steamcmdImage: string
  gameDstImage: string
}

export interface RuntimeEnvironmentImageView {
  label: string
  value: string
}

export interface RuntimeEnvironmentTagView {
  text: string
  type: RuntimeEnvironmentTagType
}

export interface RuntimeEnvironmentHint {
  tone: 'warning' | 'error'
  text: string
}

export interface RuntimeEnvironmentView {
  /** 安装与运行是否共用同一镜像引用（仅 Docker 模式下可能为 true） */
  imageUnified: boolean
  imageRows: RuntimeEnvironmentImageView[]
  /** 镜像区补充说明；无内容时为空字符串 */
  imageNote: string
  tags: RuntimeEnvironmentTagView[]
  primaryActionLabel: string
  secondaryPullVisible: boolean
  hint: RuntimeEnvironmentHint | null
}

export const UNIFIED_IMAGE_LABEL = '统一镜像（面板 + DST 运行环境 + SteamCMD）'
export const UNIFIED_IMAGE_NOTE = '安装与运行共用同一镜像；面板更新时会同步该引用。'
export const SPLIT_IMAGE_NOTE = '当前配置为两个不同的镜像引用；面板更新后会同步为统一镜像。'
/** 实例数据目录显示的是面板容器内路径，与宿主机目录不是一回事 */
export const INSTANCE_ROOT_NOTE = '面板容器内路径；宿主机实际目录由部署配置（PANEL_INSTANCES_DIR 或数据卷）决定。'

const DOCKER_UNAVAILABLE_HINT = '面板无法连接 Docker。请确认 Docker 已启动，且 Compose 部署时已挂载 Docker 套接字。'
const NATIVE_UNAVAILABLE_HINT = '面板无法连接 systemd 用户服务管理器。请检查 gsh 用户 linger、user bus 与系统服务状态。'
const NATIVE_STEAMCMD_MISSING_HINT = '安装脚本通常会预装 SteamCMD；若检查失败，请确认路径与执行权限。'
const UNIFIED_IMAGE_MISSING_HINT = '首次创建实例时会自动拉取统一镜像；提前准备可减少创建等待时间。'
const SPLIT_IMAGE_MISSING_HINT = '首次创建实例时会自动拉取游戏安装镜像；提前拉取可减少创建等待时间。'

/**
 * 仅比较字符串（trim 后），不做 registry 规范化：后端也是直接比较引用字符串，
 * 前端如果比后端「更聪明」，就会出现显示与真实拉取不一致的情况。
 */
function isUnifiedImageRef(steamcmdImage: string, gameDstImage: string): boolean {
  const steamcmd = steamcmdImage.trim()
  const gameDst = gameDstImage.trim()
  return steamcmd !== '' && steamcmd === gameDst
}

export function resolveRuntimeEnvironmentView(input: RuntimeEnvironmentInput): RuntimeEnvironmentView {
  const { isNativeMode, runtimeAvailable } = input
  const imageReady = input.steamcmdInstalled && input.gameDstInstalled
  const imageUnified = !isNativeMode && isUnifiedImageRef(input.steamcmdImage, input.gameDstImage)

  const imageRows: RuntimeEnvironmentImageView[] = isNativeMode
    ? [{ label: 'SteamCMD 路径', value: input.steamcmdImage }]
    : imageUnified
      ? [{ label: UNIFIED_IMAGE_LABEL, value: input.steamcmdImage }]
      : [
          { label: '游戏安装镜像', value: input.steamcmdImage },
          { label: '游戏运行镜像', value: input.gameDstImage },
        ]

  const tags: RuntimeEnvironmentTagView[] = [isNativeMode
    ? { text: runtimeAvailable ? 'systemd 可用' : 'systemd 不可用', type: runtimeAvailable ? 'success' : 'error' }
    : { text: runtimeAvailable ? 'Docker 可用' : 'Docker 不可用', type: runtimeAvailable ? 'success' : 'error' }]

  if (isNativeMode) {
    tags.push({
      text: input.steamcmdInstalled ? 'SteamCMD 已就绪' : 'SteamCMD 未就绪',
      type: input.steamcmdInstalled ? 'success' : 'default',
    })
    tags.push({ text: '游戏进程由 systemd 管理', type: 'info' })
  }
  else if (imageUnified) {
    // 同源时两个就绪判定检查的是同一引用，合并为一条标签，避免同值双份展示
    tags.push({ text: imageReady ? '统一镜像已就绪' : '统一镜像未就绪', type: imageReady ? 'success' : 'default' })
  }
  else {
    tags.push({
      text: input.steamcmdInstalled ? 'SteamCMD 已就绪' : 'SteamCMD 未就绪',
      type: input.steamcmdInstalled ? 'success' : 'default',
    })
    tags.push({
      text: input.gameDstInstalled ? 'DST 运行镜像已就绪' : '安装实例后自动准备',
      type: input.gameDstInstalled ? 'success' : 'warning',
    })
  }

  let hint: RuntimeEnvironmentHint | null = null
  if (!runtimeAvailable) {
    hint = { tone: 'error', text: isNativeMode ? NATIVE_UNAVAILABLE_HINT : DOCKER_UNAVAILABLE_HINT }
  }
  else if (isNativeMode && !input.steamcmdInstalled) {
    hint = { tone: 'warning', text: NATIVE_STEAMCMD_MISSING_HINT }
  }
  else if (!isNativeMode && !imageReady) {
    hint = {
      tone: 'warning',
      text: imageUnified ? UNIFIED_IMAGE_MISSING_HINT : SPLIT_IMAGE_MISSING_HINT,
    }
  }

  return {
    imageUnified,
    imageRows,
    imageNote: isNativeMode ? '' : (imageUnified ? UNIFIED_IMAGE_NOTE : SPLIT_IMAGE_NOTE),
    tags,
    primaryActionLabel: isNativeMode ? '检查 SteamCMD' : '准备运行镜像',
    secondaryPullVisible: !isNativeMode && !input.gameDstInstalled,
    hint,
  }
}
