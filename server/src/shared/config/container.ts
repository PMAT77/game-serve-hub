import { loadServerConfig } from './index'

export interface ServerContainerConfig {
  runtimeMode: 'docker' | 'native'
  dockerHost: string
  instancesRoot: string
  backupsRoot: string
  nativeRuntimeDir: string
  nativeSteamcmdPath: string
  nativeSystemdUnitDir: string
  gameDstImage: string
  steamcmdImage: string
  imageMirrors: string[]
  edition: string
}

export function getServerContainerConfig(): ServerContainerConfig {
  const config = loadServerConfig()
  return {
    runtimeMode: config.runtimeMode,
    dockerHost: config.dockerHost,
    instancesRoot: config.instancesRoot,
    backupsRoot: config.backupsRoot,
    nativeRuntimeDir: config.nativeRuntimeDir,
    nativeSteamcmdPath: config.nativeSteamcmdPath,
    nativeSystemdUnitDir: config.nativeSystemdUnitDir,
    gameDstImage: config.gameDstImage,
    steamcmdImage: config.steamcmdImage,
    imageMirrors: config.imageMirrors,
    edition: config.edition,
  }
}
