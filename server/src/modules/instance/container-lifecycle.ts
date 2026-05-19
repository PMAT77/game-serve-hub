import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import DockerClient from 'dockerode'
import { resolveDockerStatus } from '../../infra/docker'
import { resolveDockerConnectOptions } from '../../infra/docker-connect'
import {
  formatGameDstImageError,
  isSteamcmdImagePresent,
  pullGameDstImage,
  getContainerRuntime,
} from '../../infra/container'
import { resolveInstanceContainerBind } from '../../infra/container/steamcmd-install-bind'
import { buildMasterContainerName } from '../../infra/container/naming'
import type { ContainerRef, ContainerRuntime } from '../../infra/container/types'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import {
  buildDstStartBlockedMessage,
  diagnoseDstInstallReadiness,
} from '../../infra/game-adapter/dst/install-readiness'
import { buildDstMasterShardContainerSpec } from '../../infra/game-adapter/dst/runtime-spec'
import { getServerContainerConfig } from '../../shared/config/container'
import { instanceConsoleLogStore } from '../../shared/instance-runtime/console-log-store'
import { getGameInstanceById, updateGameInstanceRuntime } from '../../shared/db/index'

const logFollowAbortControllers = new Map<string, AbortController>()

export async function ensureContainerRuntimeReady(): Promise<{ ok: boolean, message?: string }> {
  if ((await resolveDockerStatus()) !== 'running') {
    return { ok: false, message: '无法连接 Docker，请确认面板已挂载 docker.sock（或 Windows 下 Docker Desktop 已启动）' }
  }
  const imageReady = await isSteamcmdImagePresent()
  if (!imageReady) {
    return { ok: false, message: 'SteamCMD 镜像未就绪，请在实例页点击「拉取 / 检测 SteamCMD 镜像」后再操作' }
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

async function readRecentContainerLogs(runtime: ContainerRuntime, ref: ContainerRef, tail = 20): Promise<string> {
  const lines: string[] = []
  try {
    for await (const line of runtime.logs(ref, { tail })) {
      lines.push(line.text)
    }
  }
  catch {
    return ''
  }
  return lines.slice(-tail).join('\n').trim()
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
  const { gameDstImage, instancesRoot, dockerHost } = getServerContainerConfig()
  const docker = new DockerClient(resolveDockerConnectOptions(dockerHost))
  const bindPlan = await resolveInstanceContainerBind(docker, input.installPath, instancesRoot)
  const spec = buildDstMasterShardContainerSpec({
    instanceId: input.instanceId,
    hostInstallPath: input.installPath,
    image: gameDstImage,
    containerGameRoot: bindPlan.containerGameRoot,
    clusterInput: {
      instanceName: input.instanceName,
      gamePort: input.gamePort,
    },
  })
  if (!spec) {
    const readiness = diagnoseDstInstallReadiness(input.installPath)
    const steamcmdImageReady = await isSteamcmdImagePresent()
    return {
      ok: false,
      message: buildDstStartBlockedMessage(readiness, steamcmdImageReady, {
        instanceStatus: 'error',
      }),
    }
  }
  app.log.info({ gameDstImage, bindMode: bindPlan.mode, hostBinds: bindPlan.hostBinds }, '确保 DST 运行镜像可用')
  const imagePull = await pullGameDstImage()
  if (!imagePull.ok) {
    return { ok: false, message: imagePull.error }
  }
  spec.hostBinds = bindPlan.hostBinds
  const runtime = getContainerRuntime()
  let ref: ContainerRef
  try {
    ref = await runtime.createShardContainer(spec)
  }
  catch (error) {
    const raw = error instanceof Error ? error.message : '创建实例容器失败'
    return { ok: false, message: formatGameDstImageError(raw, gameDstImage) }
  }
  try {
    await runtime.start(ref)
  }
  catch (error) {
    await runtime.remove(ref)
    const raw = error instanceof Error ? error.message : '容器启动失败'
    return { ok: false, message: formatGameDstImageError(raw, gameDstImage) }
  }
  const inspect = await runtime.inspect(ref)
  if (!inspect.running) {
    const logTail = await readRecentContainerLogs(runtime, ref)
    await runtime.remove(ref)
    const hint = logTail || '容器启动后立即退出，请检查安装目录挂载与游戏文件是否完整'
    return { ok: false, message: hint }
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
  const instance = await getGameInstanceById(instanceId)
  const ref = await resolveInstanceContainerRef(instanceId)
  if (!ref) {
    if (instance?.status === 'running') {
      await updateGameInstanceRuntime(instanceId, {
        status: 'stopped',
        containerId: null,
        runtimePid: null,
        runtimeStartedAt: null,
        lastError: null,
      })
    }
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
