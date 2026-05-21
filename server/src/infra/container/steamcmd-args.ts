export interface BuildSteamcmdAppUpdateArgsOptions {
  /** Steam 下载区域代码，如 cn / shanghai / beijing */
  downloadRegion?: string
}

/** SteamCMD 要求 +force_install_dir 必须在 +login 之前，否则会出现 before logon / Missing file permissions */
export function buildSteamcmdAppUpdateArgs(
  installPath: string,
  appId: string,
  loginArgs: string[],
  options?: BuildSteamcmdAppUpdateArgsOptions,
) {
  const prefix: string[] = [
    '+@ShutdownOnFailedCommand',
    '1',
    '+@NoPromptForPassword',
    '1',
    '+@sSteamCmdForcePlatformType',
    'linux',
  ]
  const region = options?.downloadRegion?.trim()
  if (region) {
    prefix.push('+@sSteamCmdForceRegion', region)
  }
  return [
    ...prefix,
    '+force_install_dir',
    installPath,
    ...loginArgs,
    '+app_update',
    appId,
    'validate',
    '+quit',
  ]
}
