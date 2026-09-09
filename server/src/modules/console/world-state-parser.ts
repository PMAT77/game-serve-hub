/**
 * 世界运行时状态日志解析。
 *
 * 后端向游戏容器控制台注入：
 *   print("GSHWS:"..tostring(TheWorld.state.cycles)..":"..tostring(TheWorld.state.season)..":"..tostring(TheWorld.state.elapseddaysinseason))
 * 游戏进程会在 stdout 打印形如 `GSHWS:102:autumn:3` 的标记行，
 * 本模块从控制台日志流中定位并解析该标记。
 */

export interface ParsedWorldState {
  cycles: number
  season: string
  daysInSeason: number
}

/** 与注入指令保持一致的前缀（前缀独特，避免与 Mod/游戏自身日志混淆） */
export const WORLD_STATE_LOG_PREFIX = 'GSHWS:'

const WORLD_STATE_LINE_PATTERN = /GSHWS:(\d+):([A-Za-z_]+):(\d+)/

/** 从单行日志文本解析世界状态；非标记行返回 null */
export function parseWorldStateLogLine(text: string): ParsedWorldState | null {
  const match = WORLD_STATE_LINE_PATTERN.exec(text)
  if (!match) {
    return null
  }
  const cycles = Number(match[1])
  const daysInSeason = Number(match[3])
  if (!Number.isFinite(cycles) || !Number.isFinite(daysInSeason)) {
    return null
  }
  return {
    cycles,
    season: match[2]!,
    daysInSeason,
  }
}

/** 构造注入到游戏控制台的查询指令 */
export function buildWorldStateQueryCommand(): string {
  return `print("${WORLD_STATE_LOG_PREFIX}"..tostring(TheWorld.state.cycles)..":"..tostring(TheWorld.state.season)..":"..tostring(TheWorld.state.elapseddaysinseason))`
}
