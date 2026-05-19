import { getServerContainerConfig } from '../../shared/config/container'
import { DockerContainerRuntime } from './docker-runtime'
import type { ContainerRuntime } from './types'

let runtime: ContainerRuntime | undefined

export function getContainerRuntime(): ContainerRuntime {
  if (!runtime) {
    const { dockerHost } = getServerContainerConfig()
    runtime = new DockerContainerRuntime(dockerHost)
  }
  return runtime
}

export * from './types'
export * from './naming'
export {
  runSteamcmdAppUpdateInContainer,
  runSteamcmdAppInfoInContainer,
  cancelSteamcmdInstallContainer,
  cleanupOrphanedSteamcmdInstallContainers,
  isSteamcmdJobRunning,
  isSteamcmdImagePresent,
  pullSteamcmdImage,
} from './steamcmd-runner'
export {
  formatGameDstImageError,
  isGameDstImagePresent,
  pullGameDstImage,
} from './game-dst-image'
export { ensureSteamcmdImage } from './runtime-images'
