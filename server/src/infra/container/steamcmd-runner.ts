import type Docker from 'dockerode'
import DockerClient from 'dockerode'
import { getServerContainerConfig } from '../../shared/config/container'

const STEAMCMD_APP_UPDATE_TIMEOUT_MS = 30 * 60 * 1000

function resolveDocker(): Docker {
  const { dockerHost } = getServerContainerConfig()
  const raw = dockerHost?.trim() || 'unix:///var/run/docker.sock'
  if (raw.startsWith('unix://')) {
    return new DockerClient({ socketPath: raw.replace(/^unix:\/\//, '') })
  }
  return new DockerClient({ host: raw })
}

function buildSteamcmdArgs(installPath: string, appId: string, loginArgs: string[]) {
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

export async function runSteamcmdAppUpdateInContainer(input: {
  hostInstallPath: string
  appId: string
  loginArgs: string[]
  onLogLine?: (line: string) => void
}): Promise<{ ok: boolean, output: string }> {
  const { steamcmdImage } = getServerContainerConfig()
  const containerInstallPath = '/game'
  const docker = resolveDocker()
  const logLines: string[] = []
  const pushLine = (line: string) => {
    const text = line.trim()
    if (!text) {
      return
    }
    logLines.push(text)
    if (logLines.length > 80) {
      logLines.shift()
    }
    input.onLogLine?.(text)
  }

  const container = await docker.createContainer({
    Image: steamcmdImage,
    Cmd: [
      '/home/steam/steamcmd/steamcmd.sh',
      ...buildSteamcmdArgs(containerInstallPath, input.appId, input.loginArgs),
    ],
    HostConfig: {
      Binds: [`${input.hostInstallPath}:${containerInstallPath}`],
      AutoRemove: true,
    },
    AttachStdout: true,
    AttachStderr: true,
  })

  const stream = await container.attach({ stream: true, stdout: true, stderr: true })
  const waitPromise = container.wait()
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let exitCode = -1
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    void container.kill()
  }, STEAMCMD_APP_UPDATE_TIMEOUT_MS)

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.length > 8 ? chunk.subarray(8).toString('utf8') : chunk.toString('utf8')
      let buffer = stdoutBuffer + text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      stdoutBuffer = buffer
      for (const line of lines) {
        pushLine(line)
      }
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })

  try {
    const result = await waitPromise
    exitCode = result.StatusCode ?? -1
  }
  finally {
    clearTimeout(timeout)
    try {
      await container.remove({ force: true })
    }
    catch {
      // AutoRemove or already gone
    }
  }

  if (stderrBuffer.trim()) {
    pushLine(stderrBuffer)
  }
  if (stdoutBuffer.trim()) {
    pushLine(stdoutBuffer)
  }

  const output = logLines.slice(-20).join('\n') || (timedOut ? 'SteamCMD 安装超时' : 'SteamCMD app_update 执行失败')
  return {
    ok: exitCode === 0 && !timedOut,
    output,
  }
}

export async function ensureSteamcmdImageAvailable(): Promise<boolean> {
  try {
    const docker = resolveDocker()
    const { steamcmdImage } = getServerContainerConfig()
    await docker.getImage(steamcmdImage).inspect()
    return true
  }
  catch {
    try {
      const docker = resolveDocker()
      const { steamcmdImage } = getServerContainerConfig()
      await new Promise<void>((resolve, reject) => {
        docker.pull(steamcmdImage, (error: Error | null) => {
          if (error) {
            reject(error)
          }
          else {
            resolve()
          }
        })
      })
      return true
    }
    catch {
      return false
    }
  }
}
