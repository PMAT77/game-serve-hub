/**
 * 玩家操作的「结果判定」。
 *
 * 命令是否送达、游戏打印了什么，都只是过程：真正决定成败的是「复查在线名单里
 * 那个人还在不在」（踢人曾经无条件回报「命令已送达房间」，而命令实际被游戏忽略时，
 * 管理员看到成功却看到玩家还在原地——这比直接报错更糟）。
 *
 * 面向管理员的话只说结果与下一步动作；命令原文、游戏输出这类技术细节留在
 * 面板日志里，不进提示文案。
 */

/** DST 执行 Lua 失败时打印的典型行；用于在面板日志里带上游戏侧原因 */
const LUA_ERROR_PATTERNS: RegExp[] = [
  /attempt to (?:call|index|compare|perform)/i,
  /^stack traceback:/i,
  /script error/i,
  /error loading module/i,
]

/** 单条线索最多带回多少字符，避免把整段栈写进日志 */
const MAX_HINT_LENGTH = 200

/**
 * 从命令下发后新增的日志行里找出第一条 Lua 报错线索。
 *
 * 只做「有没有、是哪一行」的判断，不解析：DST 的报错格式随版本变化，
 * 认不出来时返回 null（含义是「没发现报错」，不是「一定没报错」）。
 */
export function findPlayerActionError(lines: string[]): string | null {
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    if (LUA_ERROR_PATTERNS.some(pattern => pattern.test(line))) {
      return line.length > MAX_HINT_LENGTH ? `${line.slice(0, MAX_HINT_LENGTH)}…` : line
    }
  }
  return null
}

export interface PlayerActionOutcomeInput {
  /** 目标玩家在复查的在线名单里是否仍然存在：null 表示这次没查到（「不知道」） */
  stillOnline: boolean | null
  /** 动作名，用于组织文案 */
  action: PlayerActionKind
}

/**
 * 面板能对玩家做的三种动作。
 *
 * `despawn` 是给房间主人准备的：那条连接就是服务器本身，断不开（实测：不报错、
 * 人也不掉线），只能把他从世界里移出去、送回角色选择界面。
 */
export type PlayerActionKind = 'kick' | 'ban' | 'despawn'

const ACTION_MESSAGES: Record<PlayerActionKind, { done: string, failed: string }> = {
  kick: { done: '已踢出该玩家', failed: '没能踢出该玩家，请改用封禁' },
  ban: { done: '已封禁该玩家', failed: '没能封禁该玩家，请重试' },
  despawn: { done: '已把该玩家移出世界', failed: '没能把该玩家移出世界，请重试' },
}

export interface PlayerActionOutcome {
  /** true 仅当复查确认玩家已离开房间 */
  verified: boolean
  /** 面向管理员的一句话；界面会把「该玩家」替换成具体名字 */
  message: string
}

/**
 * 生成面向管理员的结论。
 *
 * 三句话分别对应三种事实：确认走了、确认还在（并给出下一步动作）、没能确认。
 * 不用「成功」二字糊弄，也不解释命令为什么要这样写——那是日志的事。
 */
export function describePlayerActionOutcome(input: PlayerActionOutcomeInput): PlayerActionOutcome {
  const messages = ACTION_MESSAGES[input.action]

  if (input.stillOnline === false) {
    return { verified: true, message: messages.done }
  }

  if (input.stillOnline === true) {
    return { verified: false, message: messages.failed }
  }

  return {
    verified: false,
    message: '没能确认结果，请刷新在线列表',
  }
}
