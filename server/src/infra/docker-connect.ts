import process from 'node:process'
import type Docker from 'dockerode'
import DockerClient from 'dockerode'

/**
 * 业务模块统一经此工厂获取 Docker 客户端，不得直接实例化 dockerode——
 * dockerode 依赖只允许出现在 infra 层。
 */
export function createDockerClient(dockerHost?: string): Docker {
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

export function resolveDockerConnectOptions(dockerHost?: string) {
  const raw = dockerHost?.trim() || process.env.DOCKER_HOST?.trim() || defaultDockerHost()
  if (raw.startsWith('unix://')) {
    return { socketPath: raw.replace(/^unix:\/\//, '') }
  }
  if (raw.startsWith('npipe://')) {
    return { socketPath: raw.replace(/^npipe:\/\//, '') }
  }
  return { host: raw }
}

function defaultDockerHost(): string {
  return process.platform === 'win32'
    ? 'npipe:////./pipe/docker_engine'
    : 'unix:///var/run/docker.sock'
}

/** Docker 守护进程不可达（未启动、socket 不存在等） */
export function isDockerUnavailableError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException | undefined
  const code = err?.code ?? ''
  const message = error instanceof Error ? error.message : String(error)
  return code === 'ENOENT'
    || code === 'ECONNREFUSED'
    || code === 'ECONNRESET'
    || /docker_engine|connect ENOENT|ECONNREFUSED|socket.*not found/i.test(message)
}
