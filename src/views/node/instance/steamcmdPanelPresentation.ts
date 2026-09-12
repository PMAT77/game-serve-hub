/**
 * 运行环境卡片（SteamcmdPanel）的展示决策。
 *
 * v0.2.0 起面板 / DST 运行环境 / SteamCMD 合并为同一镜像，默认部署下
 * steamcmdImage 与 gameDstImage 是同一个引用；面板一键更新还会把三者写成同一 tag
 * （见 server/src/modules/system/panel-update.ts）。因此这里把「同源合并、异构退化」
 * 的判断收敛到纯函数，模板只负责渲染。
 *
 * 文案只写面板使用者能理解、能据以行动的内容：不放部署变量名、镜像组成、内部同步
 * 机制这类实现细节。
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
  tags: RuntimeEnvironmentTagView[]
  primaryActionLabel: string
  secondaryPullVisible: boolean
  hint: RuntimeEnvironmentHint | null
}

const DOCKER_UNAVAILABLE_HINT = '面板未连上 Docker，请确认 Docker 已启动。'
const NATIVE_UNAVAILABLE_HINT = '运行环境不可用，请确认系统服务已启动。'
const IMAGE_MISSING_HINT = '提前准备可缩短创建实例的等待。'

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
      ? [{ label: '游戏镜像', value: input.steamcmdImage }]
      : [
          { label: '安装镜像', value: input.steamcmdImage },
          { label: '运行镜像', value: input.gameDstImage },
        ]

  const tags: RuntimeEnvironmentTagView[] = [isNativeMode
    ? { text: runtimeAvailable ? '运行环境正常' : '运行环境异常', type: runtimeAvailable ? 'success' : 'error' }
    : { text: runtimeAvailable ? 'Docker 可用' : 'Docker 不可用', type: runtimeAvailable ? 'success' : 'error' }]

  if (isNativeMode) {
    tags.push({
      text: input.steamcmdInstalled ? 'SteamCMD 已就绪' : 'SteamCMD 未就绪',
      type: input.steamcmdInstalled ? 'success' : 'default',
    })
  }
  else if (imageUnified) {
    // 同源时两个就绪判定检查的是同一引用，合并为一条标签，避免同值双份展示
    tags.push({
      text: imageReady ? '游戏镜像已就绪' : '游戏镜像未就绪',
      type: imageReady ? 'success' : 'default',
    })
  }
  else {
    tags.push({
      text: input.steamcmdInstalled ? '安装镜像已就绪' : '安装镜像未就绪',
      type: input.steamcmdInstalled ? 'success' : 'default',
    })
    tags.push({
      text: input.gameDstInstalled ? '运行镜像已就绪' : '安装实例后自动准备',
      type: input.gameDstInstalled ? 'success' : 'warning',
    })
  }

  let hint: RuntimeEnvironmentHint | null = null
  if (!runtimeAvailable) {
    hint = { tone: 'error', text: isNativeMode ? NATIVE_UNAVAILABLE_HINT : DOCKER_UNAVAILABLE_HINT }
  }
  else if (!isNativeMode && !imageReady) {
    hint = { tone: 'warning', text: IMAGE_MISSING_HINT }
  }

  return {
    imageUnified,
    imageRows,
    tags,
    primaryActionLabel: isNativeMode ? '检查 SteamCMD' : '准备游戏镜像',
    secondaryPullVisible: !isNativeMode && !input.gameDstInstalled,
    hint,
  }
}
