/**
 * 玩家名单的警告文案。
 *
 * 单独放一个模块是为了能直接测：这类「把文案里某个词切出来做成入口」的逻辑
 * 边界不少（词在开头 / 结尾 / 出现多次 / 完全没提到），塞在组件里覆盖不到。
 */

/** 警告文案里要变成入口的那个词 */
export const ROOM_SETTINGS_LABEL = '房间设置'

/** 白名单未启用时的提示：预留位在房间设置里，这句话里就带着去那里的入口 */
export const WHITELIST_DISABLED_WARNING
  = `白名单当前未启用：白名单预留位为 0。请到「房间管理 → ${ROOM_SETTINGS_LABEL}」把预留位填成大于 0 的数字并保存。`

/** 切好的一段；link 为 true 时界面要把它渲染成可点的入口 */
export interface WarningSegment {
  text: string
  link: boolean
}

/**
 * 把警告文案里的「房间设置」挑出来做成可点的一段。
 *
 * 文案本身留在上面维护，界面只在渲染时补这一处跳转：改措辞也不会漏掉入口，
 * 以后别的警告只要提到「房间设置」，同样会自动可点。
 */
export function splitRoomSettingsLinks(text: string): WarningSegment[] {
  const segments: WarningSegment[] = []
  let rest = text
  let index = rest.indexOf(ROOM_SETTINGS_LABEL)
  while (index !== -1) {
    if (index > 0) {
      segments.push({ text: rest.slice(0, index), link: false })
    }
    segments.push({ text: ROOM_SETTINGS_LABEL, link: true })
    rest = rest.slice(index + ROOM_SETTINGS_LABEL.length)
    index = rest.indexOf(ROOM_SETTINGS_LABEL)
  }
  if (rest) {
    segments.push({ text: rest, link: false })
  }
  return segments
}
