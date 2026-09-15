import {
  routeToDstModList,
  routeToDstRoomList,
  routeToDstWorldList,
  routeToNodeInstance,
  routeToOpsBackups,
} from '@/navigation/game-routes'

/** 文档链接指向默认分支：避免把版本号写死在引导文案里，发版后还要记得改 */
export const DOCS_BASE = 'https://github.com/PMAT77/game-serve-hub/blob/main/docs'

export interface GettingStartedStep {
  id: string
  title: string
  description: string
  /** 面板内跳转目标 */
  to?: ReturnType<typeof routeToNodeInstance>
  /** 对应文档（新窗口打开） */
  docUrl: string
}

/**
 * 首次登录的清单式引导。
 *
 * 做成可关闭的卡片而不是强制向导：安装教程类用户经常会先四处点一圈，
 * 强制弹窗会被直接关掉，反而什么都没记住。
 */
export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  {
    id: 'check-environment',
    title: '检查运行环境',
    description: '系统设置里的「环境自检」会检查运行环境、磁盘余量、数据目录与实例状态。',
    docUrl: `${DOCS_BASE}/INSTALL.md`,
  },
  {
    id: 'create-instance',
    title: '创建实例并安装游戏',
    description: '在实例管理里创建实例，面板会自动用 SteamCMD 下载安装游戏服务端。',
    to: routeToNodeInstance(),
    docUrl: `${DOCS_BASE}/DST_TUTORIAL.md`,
  },
  {
    id: 'configure-room',
    title: '配置房间',
    description: '填房间名、人数与联网方式；公网联机需要先填 Klei 集群令牌。',
    to: routeToDstRoomList(),
    docUrl: `${DOCS_BASE}/DST_TUTORIAL.md`,
  },
  {
    id: 'configure-world',
    title: '配置世界与 Mod',
    description: '地上与洞穴的世界规则、地图参数在这里调；需要 Mod 时先到模组管理订阅。',
    to: routeToDstWorldList(),
    docUrl: `${DOCS_BASE}/DST_TUTORIAL.md`,
  },
  {
    id: 'start-instance',
    title: '启动并进服',
    description: '回到实例管理点启动，首次启动会生成地图；控制台里可以复制直连命令。',
    to: routeToNodeInstance(),
    docUrl: `${DOCS_BASE}/DST_TUTORIAL.md`,
  },
  {
    id: 'schedule-backup',
    title: '把备份交给计划任务',
    description: '计划任务支持定时备份与重启；备份与恢复页可以下载存档做异地留存。',
    to: routeToOpsBackups(),
    docUrl: `${DOCS_BASE}/DST_TUTORIAL.md`,
  },
]

/** 需要 Mod 时可单独看的一步，不占主线顺序 */
export const GETTING_STARTED_MOD_STEP: GettingStartedStep = {
  id: 'browse-mods',
  title: '订阅 Mod（可选）',
  description: '在模组管理里搜索创意工坊 Mod 并订阅，再到世界设置里启用。',
  to: routeToDstModList(),
  docUrl: `${DOCS_BASE}/DST_TUTORIAL.md`,
}

const DISMISS_STORAGE_PREFIX = 'gsh-getting-started-dismissed:'

/** 按账号记忆：同一台机器上换账号登录应当重新看到引导 */
export function getGettingStartedDismissKey(account: string) {
  return `${DISMISS_STORAGE_PREFIX}${account.trim() || 'anonymous'}`
}

export function isGettingStartedDismissed(account: string): boolean {
  return localStorage.getItem(getGettingStartedDismissKey(account)) === '1'
}

export function setGettingStartedDismissed(account: string) {
  localStorage.setItem(getGettingStartedDismissKey(account), '1')
}

export interface GettingStartedState {
  instanceCount: number
  runningInstanceCount: number
}

export interface GettingStartedProgress {
  /** 当前应该做的一步 */
  currentStepId: string
  /** 已经完成（按可观测状态推断）的步骤 */
  completedStepIds: string[]
  /** 卡片标题下的一句话小结 */
  summary: string
}

/**
 * 按可观测状态推断进度。
 *
 * 只用「有没有实例」「有没有在运行的实例」这两个能直接查到的事实来判断：
 * 「房间是否配好」「世界是否调过」需要额外请求与更细的判断，宁可少标一步完成，
 * 也不要在界面上给出与实际不符的进度。
 */
export function resolveGettingStartedProgress(state: GettingStartedState): GettingStartedProgress {
  if (state.instanceCount <= 0) {
    return {
      currentStepId: 'create-instance',
      completedStepIds: ['check-environment'],
      summary: '还没有实例：先创建一个实例，面板会自动下载安装游戏服务端。',
    }
  }
  if (state.runningInstanceCount <= 0) {
    return {
      currentStepId: 'configure-room',
      completedStepIds: ['check-environment', 'create-instance'],
      summary: '实例已就绪：配好房间与世界参数，再启动就行。',
    }
  }
  return {
    currentStepId: 'schedule-backup',
    completedStepIds: ['check-environment', 'create-instance', 'configure-room', 'configure-world', 'start-instance'],
    summary: '已经有实例在运行：接下来把备份交给计划任务，省得忘了手动备份。',
  }
}
