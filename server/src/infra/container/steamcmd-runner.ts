import DockerClient from 'dockerode'
import { resolveDockerConnectOptions } from '../docker-connect'
import { getServerContainerConfig } from '../../shared/config/container'
import {
  cancelSteamcmdInstallContainer,
  cleanupOrphanedSteamcmdInstallContainers,
  isSteamcmdJobRunning,
  runSteamcmdJob,
} from './steamcmd-job'
import { buildSteamcmdAppUpdateArgs } from './steamcmd-args'
import { resolveSteamcmdInstallBind } from './steamcmd-install-bind'
import { appendSteamcmdBindMountOptions, resolveSteamcmdContainerUser } from './steamcmd-container-user'

const STEAMCMD_APP_UPDATE_TIMEOUT_MS = 30 * 60 * 1000
const STEAMCMD_APP_INFO_TIMEOUT_MS = 90_000

function resolveDocker() {
  const { dockerHost } = getServerContainerConfig()
  return new DockerClient(resolveDockerConnectOptions(dockerHost))
}

function buildSteamcmdAppInfoArgs(appId: string) {
  return [
    '+@ShutdownOnFailedCommand',
    '1',
    '+@NoPromptForPassword',
    '1',
    '+login',
    'anonymous',
    '+app_info_update',
    '1',
    '+app_info_print',
    appId,
    '+quit',
  ]
}

export { cancelSteamcmdInstallContainer, cleanupOrphanedSteamcmdInstallContainers, isSteamcmdJobRunning }

export async function runSteamcmdAppUpdateInContainer(input: {
  hostInstallPath: string
  appId: string
  loginArgs: string[]
  cancelKey?: string
  onLogLine?: (line: string) => void
}): Promise<{ ok: boolean, output: string, cancelled?: boolean }> {
  const { steamcmdImage, instancesRoot } = getServerContainerConfig()
  const docker = resolveDocker()
  const bindPlan = await resolveSteamcmdInstallBind(docker, input.hostInstallPath, instancesRoot)
  const logLines: string[] = []
  const pushLine = (line: string) => {
    logLines.push(line)
    input.onLogLine?.(line)
  }

  pushLine(`准备启动 SteamCMD 容器（镜像 ${steamcmdImage}）`)
  pushLine(`安装目录（宿主机）: ${input.hostInstallPath}`)
  pushLine(`AppID: ${input.appId}`)
  if (bindPlan.mode !== 'direct') {
    pushLine(`SteamCMD 卷挂载: ${bindPlan.hostBinds[0]} → force_install_dir ${bindPlan.containerInstallPath}`)
  }

  const steamcmdArgs = buildSteamcmdAppUpdateArgs(bindPlan.containerInstallPath, input.appId, input.loginArgs)

  const result = await runSteamcmdJob({
    image: steamcmdImage,
    cmd: [
      '/home/steam/steamcmd/steamcmd.sh',
      ...steamcmdArgs,
    ],
    hostBinds: bindPlan.hostBinds.map(appendSteamcmdBindMountOptions),
    user: resolveSteamcmdContainerUser(),
    jobId: input.cancelKey,
    kind: 'app-update',
    timeoutMs: STEAMCMD_APP_UPDATE_TIMEOUT_MS,
    onLogLine: input.onLogLine,
  })

  if (result.ok) {
    pushLine('SteamCMD app_update 已完成')
  }

  return {
    ok: result.ok,
    output: result.output || logLines.slice(-20).join('\n'),
    cancelled: result.cancelled,
  }
}

export async function runSteamcmdAppInfoInContainer(appId: string): Promise<{ ok: boolean, output: string }> {
  const { steamcmdImage } = getServerContainerConfig()
  const result = await runSteamcmdJob({
    image: steamcmdImage,
    cmd: [
      '/home/steam/steamcmd/steamcmd.sh',
      ...buildSteamcmdAppInfoArgs(appId.trim()),
    ],
    kind: 'app-info',
    timeoutMs: STEAMCMD_APP_INFO_TIMEOUT_MS,
  })

  const output = result.output
  return {
    ok: (result.ok || /"appid"\s+"/i.test(output)) && !result.timedOut,
    output: output || (result.timedOut ? 'SteamCMD app_info 查询超时' : 'SteamCMD app_info 执行失败'),
  }
}

export type SteamcmdImagePullResult = { ok: true } | { ok: false, error: string }

let steamcmdImagePullInFlight: Promise<SteamcmdImagePullResult> | null = null

function formatSteamcmdPullError(raw: string, image: string): string {
  const text = raw.trim() || `拉取 ${image} 失败`
  if (/registry-1\.docker\.io|docker\.io|connectex|ETIMEDOUT|timeout|deadline|ECONNREFUSED|failed to respond/i.test(text)) {
    return [
      `无法从 Docker Hub 拉取镜像 ${image}（网络超时或被阻断）。`,
      '可尝试：① Docker Desktop → Settings → Docker Engine 配置 registry-mirrors；',
      '② 在能访问 Hub 的网络下执行 docker pull 后重试；',
      '③ 在 panel.env / 环境变量中设置可访问的 GSH_STEAMCMD_IMAGE（镜像加速地址）。',
      `原始错误：${text}`,
    ].join('')
  }
  if (/manifest unknown|not found|404/i.test(text)) {
    return `镜像 ${image} 不存在或标签错误，请检查 GSH_STEAMCMD_IMAGE。原始错误：${text}`
  }
  return text
}

async function pullSteamcmdImageOnce(steamcmdImage: string): Promise<void> {
  const docker = resolveDocker()
  await new Promise<void>((resolve, reject) => {
    docker.pull(steamcmdImage, (pullError: Error | null, stream: NodeJS.ReadableStream) => {
      if (pullError) {
        reject(pullError)
        return
      }
      docker.modem.followProgress(stream, (progressError: Error | null) => {
        if (progressError) {
          reject(progressError)
        }
        else {
          resolve()
        }
      })
    })
  })
}

export async function isSteamcmdImagePresent(): Promise<boolean> {
  try {
    const docker = resolveDocker()
    const { steamcmdImage } = getServerContainerConfig()
    await docker.getImage(steamcmdImage).inspect()
    return true
  }
  catch {
    return false
  }
}

const STEAMCMD_PULL_MAX_ATTEMPTS = 3
const STEAMCMD_PULL_RETRY_BASE_MS = 2_000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 仅由用户显式触发（POST .../steamcmd/install），禁止在页面加载/列表轮询中调用 */
export async function pullSteamcmdImage(): Promise<SteamcmdImagePullResult> {
  if (await isSteamcmdImagePresent()) {
    return { ok: true }
  }
  if (steamcmdImagePullInFlight) {
    return steamcmdImagePullInFlight
  }
  const { steamcmdImage } = getServerContainerConfig()
  steamcmdImagePullInFlight = (async (): Promise<SteamcmdImagePullResult> => {
    let lastError = ''
    for (let attempt = 1; attempt <= STEAMCMD_PULL_MAX_ATTEMPTS; attempt++) {
      try {
        await pullSteamcmdImageOnce(steamcmdImage)
        return { ok: true }
      }
      catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (attempt < STEAMCMD_PULL_MAX_ATTEMPTS) {
          await sleep(STEAMCMD_PULL_RETRY_BASE_MS * attempt)
        }
      }
    }
    return { ok: false, error: formatSteamcmdPullError(lastError, steamcmdImage) }
  })().finally(() => {
    steamcmdImagePullInFlight = null
  })
  return steamcmdImagePullInFlight
}
