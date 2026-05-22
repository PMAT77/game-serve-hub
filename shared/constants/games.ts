/** Steam AppID / 面板 gameCode（与 game_instances.game_code 一致） */
export const GAME_CODES = {
  DST: '343050',
} as const

export type GameCode = (typeof GAME_CODES)[keyof typeof GAME_CODES]

export function isDstGameCode(gameCode: string): boolean {
  return gameCode === GAME_CODES.DST
}
