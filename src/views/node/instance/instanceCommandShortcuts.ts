import type { ClusterGameMode } from '@/api/modules/cluster'

/** DST 游戏模式英文 → 中文（cluster.gameMode 枚举全覆盖，未知值兜底展示原文） */
export const DST_GAME_MODE_LABELS: Record<ClusterGameMode, string> = {
  survival: '生存',
  endless: '无尽',
  wilderness: '荒野',
  easy: '轻松',
  darkandwildernes: '黑暗荒野',
}

/** DST 官方四季英文 → 中文（Mod 自定义季节兜底展示原文） */
export const DST_SEASON_LABELS: Record<string, string> = {
  autumn: '秋季',
  winter: '冬季',
  spring: '春季',
  summer: '夏季',
}

export function dstGameModeLabel(mode: ClusterGameMode | null | undefined): string {
  if (!mode) {
    return '—'
  }
  return DST_GAME_MODE_LABELS[mode] ?? mode
}

export function dstSeasonLabel(season: string | null | undefined): string {
  if (!season) {
    return '—'
  }
  return DST_SEASON_LABELS[season] ?? season
}

export interface InstanceQuickCommand {
  key: string
  label: string
  command: string
  /** 执行前是否需要危险确认 */
  dangerous?: boolean
  confirmTitle?: string
  confirmContent?: string
}

/** 快捷指令（实例详情页使用；保存 / 回档为控制台同名功能的超集） */
export const INSTANCE_QUICK_COMMANDS: InstanceQuickCommand[] = [
  { key: 'save', label: '保存', command: 'c_save()' },
  {
    key: 'rollback1',
    label: '回档 1 天',
    command: 'c_rollback(1)',
    dangerous: true,
    confirmTitle: '确认回档 1 天',
    confirmContent: '将把世界回退到上一个保存点，最近约 1 个游戏日内的进度会丢失且不可恢复。确认回档？',
  },
  {
    key: 'rollback2',
    label: '回档 2 天',
    command: 'c_rollback(2)',
    dangerous: true,
    confirmTitle: '确认回档 2 天',
    confirmContent: '将把世界回退到约 2 个游戏日前的存档点，期间进度会丢失且不可恢复。确认回档？',
  },
  {
    key: 'rollback3',
    label: '回档 3 天',
    command: 'c_rollback(3)',
    dangerous: true,
    confirmTitle: '确认回档 3 天',
    confirmContent: '将把世界回退到约 3 个游戏日前的存档点，期间进度会丢失且不可恢复。确认回档？',
  },
]

/** 重置世界命令（与控制台「重置世界」一致） */
export const RESET_WORLD_COMMAND = 'c_reset()'
export const RESET_WORLD_CONFIRM_TITLE = '确认重置世界？'
export const RESET_WORLD_CONFIRM_CONTENT = '将立即重新生成一个全新世界：当前世界的地形、建筑与玩家物品都会丢失且不可恢复（已保存的回档快照除外）。真的要继续吗？'
