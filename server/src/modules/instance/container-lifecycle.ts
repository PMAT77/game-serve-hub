import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import { getCachedDockerStatus } from '../../infra/docker'
import {
  ensureSteamcmdImageAvailable,
  getContainerRuntime,
} from '../../infra/container'
import { buildMasterContainerName } from '../../infra/container/naming'
import type { ContainerRef } from '../../infra/container/types'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { buildDstMasterShardContainerSpec } from '../../infra/game-adapter/dst/runtime-spec'
import { getServerContainerConfig } from '../../shared/config/container'
import { instanceConsoleLogStore } from '../../shared/instance-runtime/console-log-store'
import { getGameInstanceById, updateGameInstanceRuntime } from '../../shared/db/index'

const logFollowAbortControllers = new Map<string, AbortController>()

export async function ensureContainerRuntimeReady(): Promise<{ ok: boolean, message?: string }> {
  if (getCachedDockerStatus() !== 'running') {
    return { ok: false, message: 'Docker 未运行，请确认面板已挂载 docker.sock 且 Docker 服务正常' }
  }
  const imageReady = await ensureSteamcmdImageAvailable()
  if (!imageReady) {
    return { ok: false, message: 'SteamCMD 镜像不可用，请检查网络或 GSH_STEAMCMD_IMAGE 配置' }
  }
  return { ok: true }
}

export function resolveDefaultInstanceInstallPath(instanceId: string): string {
  const { instancesRoot } = getServerContainerConfig()
  return path.join(instancesRoot, instanceId)
}

export async function resolveInstanceContainerRef(instanceId: string): Promise<ContainerRef | undefined> {
  const instance = await getGameInstanceById(instanceId)
  if (instance?.containerId) {
    return {
      id: instance.containerId,
      name: buildMasterContainerName(instanceId),
    }
  }
  const runtime = getContainerRuntime()
  return runtime.findByName(buildMasterContainerName(instanceId))
}

export async function isInstanceContainerRunning(instanceId: string): Promise<boolean> {
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    return false
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  return inspect.running
}

function stopLogFollow(instanceId: string) {
  logFollowAbortControllers.get(instanceId)?.abort()
  logFollowAbortControllers.delete(instanceId)
}

export function startContainerLogFollow(instanceId: string, ref: ContainerRef) {
  stopLogFollow(instanceId)
  const controller = new AbortController()
  logFollowAbortControllers.set(instanceId, controller)
  instanceConsoleLogStore.appendSystem(instanceId, '已连接实例容器，开始采集控制台输出')
  void (async () => {
    const runtime = getContainerRuntime()
    try {
      for await (const line of runtime.logs(ref, { follow: true, tail: 100 })) {
        if (controller.signal.aborted) {
          break
        }
        instanceConsoleLogStore.appendDockerLine(instanceId, line.text)
      }
    }
    catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        instanceConsoleLogStore.appendSystem(instanceId, `日志流中断: ${message}`)
      }
    }
  })()
}

export async function startInstanceContainer(
  app: FastifyInstance,
  input: {
    instanceId: string
    gameCode: string
    installPath: string
    instanceName: string
    gamePort: number | null
  },
): Promise<{ ok: true, ref: ContainerRef, displayCommand: string } | { ok: false, message: string }> {
  if (input.gameCode.trim() !== DST_APP_ID) {
    return { ok: false, message: '当前仅支持饥荒（343050）容器化启动' }
  }
  const { gameDstImage } = getServerContainerConfig()
  const spec = buildDstMasterShardContainerSpec({
    instanceId: input.instanceId,
    hostInstallPath: input.installPath,
    image: gameDstImage,
    clusterInput: {
      instanceName: input.instanceName,
      gamePort: input.gamePort,
    },
  })
  if (!spec) {
    return { ok: false, message: '未在安装目录找到饥荒服务端可执行文件，请确认 SteamCMD 安装已完成' }
  }
  const runtime = getContainerRuntime()
  const ref = await runtime.createShardContainer(spec)
  try {
    await runtime.start(ref)
  }
  catch (error) {
    await runtime.remove(ref)
    const message = error instanceof Error ? error.message : '容器启动失败'
    return { ok: false, message }
  }
  const displayCommand = spec.cmd.join(' ')
  app.log.info({
    instanceId: input.instanceId,
    containerId: ref.id,
    name: ref.name,
    command: displayCommand,
  }, '实例容器已启动')
  startContainerLogFollow(input.instanceId, ref)
  return { ok: true, ref, displayCommand }
}

export async function stopInstanceContainer(instanceId: string): Promise<void> {
  stopLogFollow(instanceId)
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    await updateGameInstanceRuntime(instanceId, {
      status: 'stopped',
      containerId: null,
      runtimePid: null,
      runtimeStartedAt: null,
      lastError: null,
    })
    return
  }
  const runtime = getContainerRuntime()
  await runtime.stop(ref, 15)
  instanceConsoleLogStore.appendSystem(instanceId, '实例容器已停止')
  await updateGameInstanceRuntime(instanceId, {
    status: 'stopped',
    containerId: null,
    runtimePid: null,
    runtimeStartedAt: null,
    lastError: null,
  })
}

export async function removeInstanceContainer(instanceId: string): Promise<void> {
  stopLogFollow(instanceId)
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    return
  }
  const runtime = getContainerRuntime()
  await runtime.remove(ref)
  instanceConsoleLogStore.appendSystem(instanceId, '实例容器已删除')
}

export async function sendInstanceContainerCommand(instanceId: string, command: string): Promise<{ ok: boolean, message?: string }> {
  const trimmed = command.trim()
  if (!trimmed) {
    return { ok: false, message: '命令不能为空' }
  }
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    return { ok: false, message: '实例未运行，无法发送命令' }
  }
  const runtime = getContainerRuntime()
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    return { ok: false, message: '实例未运行，无法发送命令' }
  }
  const result = await runtime.execStdin(ref, trimmed)
  instanceConsoleLogStore.appendSystem(instanceId, `> ${trimmed}`)
  if (result.exitCode !== 0) {
    return { ok: false, message: result.output || '命令发送失败' }
  }
  return { ok: true }
}
