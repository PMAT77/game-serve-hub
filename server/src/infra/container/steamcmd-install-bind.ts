import path from 'node:path'
import type Docker from 'dockerode'

export type SteamcmdInstallBindMode = 'direct' | 'instances-volume' | 'instances-bind'

export interface SteamcmdInstallBindPlan {
  hostBinds: string[]
  containerInstallPath: string
  mode: SteamcmdInstallBindMode
}

export interface InstanceContainerBindPlan {
  hostBinds: string[]
  containerGameRoot: string
  mode: SteamcmdInstallBindMode
}

function normalizeDir(dir: string): string {
  const resolved = path.resolve(dir)
  if (resolved === path.parse(resolved).root) {
    return resolved
  }
  return resolved.replace(/[\\/]+$/, '')
}

export function isInstallPathUnderInstancesRoot(installPath: string, instancesRoot: string): boolean {
  const root = normalizeDir(instancesRoot)
  const resolved = path.resolve(installPath)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`)
}

async function resolveInstancesRootMountBind(
  docker: Docker,
  instancesRoot: string,
): Promise<{ bind: string, mode: SteamcmdInstallBindMode } | null> {
  const containerRef = process.env.HOSTNAME?.trim()
    || process.env.GSH_PANEL_CONTAINER_NAME?.trim()
  if (!containerRef) {
    return null
  }
  try {
    const inspect = await docker.getContainer(containerRef).inspect()
    const normalizedRoot = normalizeDir(instancesRoot)
    const mount = inspect.Mounts?.find((item) => normalizeDir(item.Destination) === normalizedRoot)
    if (!mount) {
      return null
    }
    if (mount.Type === 'volume' && mount.Name) {
      return { bind: `${mount.Name}:${normalizedRoot}`, mode: 'instances-volume' as const }
    }
    if (mount.Type === 'bind' && mount.Source) {
      return { bind: `${mount.Source}:${normalizedRoot}`, mode: 'instances-bind' as const }
    }
  }
  catch {
    return null
  }
  return null
}

interface InstancesRootBindPlan {
  hostBinds: string[]
  containerPath: string
  mode: SteamcmdInstallBindMode
}

/**
 * panel 在容器内通过 docker.sock 创建子容器时，不能把「仅存在于 panel 挂载命名空间」的路径
 * 当作 bind 源（Docker 会在宿主机自动 mkdir，得到空目录且 uid=0，导致 Missing file permissions）。
 */
async function resolveInstancesRootBindPlan(
  docker: Docker,
  installPath: string,
  instancesRoot: string,
): Promise<InstancesRootBindPlan> {
  const resolvedInstallPath = path.resolve(installPath)
  const normalizedRoot = normalizeDir(instancesRoot)

  if (!isInstallPathUnderInstancesRoot(resolvedInstallPath, normalizedRoot)) {
    return {
      hostBinds: [`${resolvedInstallPath}:/game`],
      containerPath: '/game',
      mode: 'direct',
    }
  }

  const rootMount = await resolveInstancesRootMountBind(docker, normalizedRoot)
  if (rootMount) {
    return {
      hostBinds: [rootMount.bind],
      containerPath: resolvedInstallPath,
      mode: rootMount.mode,
    }
  }

  return {
    hostBinds: [`${resolvedInstallPath}:/game`],
    containerPath: '/game',
    mode: 'direct',
  }
}

export async function resolveSteamcmdInstallBind(
  docker: Docker,
  installPath: string,
  instancesRoot: string,
): Promise<SteamcmdInstallBindPlan> {
  const plan = await resolveInstancesRootBindPlan(docker, installPath, instancesRoot)
  return {
    hostBinds: plan.hostBinds,
    containerInstallPath: plan.containerPath,
    mode: plan.mode,
  }
}

export async function resolveInstanceContainerBind(
  docker: Docker,
  installPath: string,
  instancesRoot: string,
): Promise<InstanceContainerBindPlan> {
  const plan = await resolveInstancesRootBindPlan(docker, installPath, instancesRoot)
  return {
    hostBinds: plan.hostBinds,
    containerGameRoot: plan.containerPath,
    mode: plan.mode,
  }
}
