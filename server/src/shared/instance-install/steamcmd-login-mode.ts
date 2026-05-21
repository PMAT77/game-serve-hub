export type SteamcmdLoginMode = 'anonymous' | 'account' | 'account-fallback'

const LOGIN_MODE_BY_APP_ID: Record<string, SteamcmdLoginMode> = {
  '343050': 'anonymous',
}

/** v1 DST 仅 anonymous；未来游戏可在映射表或 installable games 元数据中设为 account-fallback */
export function resolveSteamcmdLoginMode(appId: string): SteamcmdLoginMode {
  return LOGIN_MODE_BY_APP_ID[appId.trim()] ?? 'account-fallback'
}
