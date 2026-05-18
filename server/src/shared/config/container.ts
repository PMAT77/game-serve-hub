import { loadServerConfig } from './index'

export interface ServerContainerConfig {
  dockerHost: string
  instancesRoot: string
  backupsRoot: string
  gameDstImage: string
  steamcmdImage: string
  edition: string
}

export function getServerContainerConfig(): ServerContainerConfig {
  const config = loadServerConfig()
  return {
    dockerHost: config.dockerHost,
    instancesRoot: config.instancesRoot,
    backupsRoot: config.backupsRoot,
    gameDstImage: config.gameDstImage,
    steamcmdImage: config.steamcmdImage,
    edition: config.edition,
  }
}
