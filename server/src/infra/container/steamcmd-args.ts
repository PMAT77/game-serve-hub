/** SteamCMD 要求 +force_install_dir 必须在 +login 之前，否则会出现 before logon / Missing file permissions */
export function buildSteamcmdAppUpdateArgs(installPath: string, appId: string, loginArgs: string[]) {
  return [
    '+@ShutdownOnFailedCommand',
    '1',
    '+@NoPromptForPassword',
    '1',
    '+force_install_dir',
    installPath,
    ...loginArgs,
    '+app_update',
    appId,
    'validate',
    '+quit',
  ]
}
