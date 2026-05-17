import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { ApiErrorResponse, ApiSuccessResponse } from '../../../../shared/contracts/api'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  createGameInstance,
  deleteGameInstanceById,
  findUserByToken,
  getGameInstanceById,
  getServerNodeById,
  getSystemSteamcmdConfig,
  listGameInstances,
  updateGameInstanceRuntime,
} from '../../shared/db/index'
import { instanceRuntimeRegistry } from '../../shared/instance-runtime/registry'
import { businessError, success, unauthorized } from '../../shared/http/response'

interface InstanceListQuery {
  nodeId?: string
  status?: 'pending_install' | 'running' | 'stopped' | 'installing' | 'error'
  keyword?: string
}

interface CreateInstanceBody {
  nodeId?: string
  name?: string
  gameCode?: string
  installPath?: string
  configPath?: string
  queryPort?: number
  gamePort?: number
  rconPort?: number
}

interface InstanceActionBody {
  id?: string
}

interface InstallLogQuery {
  id?: string
}

interface InstallableGameItem {
  appId: string
  name: string
}

interface InstanceInstallLogSnapshot {
  instanceId: string
  status: 'success' | 'failed' | 'running'
  content: string
  updatedAt: string
}

type InstallLogSource = 'install_log' | 'status_summary' | 'empty'

interface InstallLogResponse {
  content: string
  status: 'success' | 'failed' | 'running' | 'unknown'
  updatedAt: string | null
  source: InstallLogSource
}

const LOCAL_NODE_ID = 'local-node'
const DANGEROUS_WINDOWS_PATHS = [
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  'Users',
]
const LEGACY_DEFAULT_INSTALL_ROOT = path.resolve(process.cwd(), 'data', 'instances')
const STEAMCMD_APP_UPDATE_TIMEOUT_MS = 30 * 60 * 1000
const INSTALLABLE_GAMES: InstallableGameItem[] = [
  {
    appId: '343050',
    name: '饥荒联机（Dedicated Server）',
  },
]

const stoppingInstanceIds = new Set<string>()
const instanceInstallLogMap = new Map<string, InstanceInstallLogSnapshot>()

function normalizeToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return tokenHeader ?? ''
}

function getTokenByRequest(request: FastifyRequest): string | undefined {
  const token = normalizeToken(request.headers.token)
  if (!token) {
    return undefined
  }
  return token
}

async function verifyAuthorized(request: FastifyRequest): Promise<ApiErrorResponse | undefined> {
  const token = getTokenByRequest(request)
  if (!token) {
    return unauthorized(request)
  }
  const user = await findUserByToken(token)
  if (!user) {
    return unauthorized(request)
  }
}

function normalizeInstanceId(value: string | undefined) {
  return value?.trim() ?? ''
}

function normalizePort(value: number | undefined): number | null {
  if (typeof value === 'undefined') {
    return null
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null
  }
  return value
}

function normalizeInstallPath(value: string | undefined): string {
  return value?.trim() ?? ''
}

function resolveInstallableGameByAppId(value: string | undefined): InstallableGameItem | undefined {
  const appId = value?.trim() ?? ''
  return INSTALLABLE_GAMES.find(game => game.appId === appId)
}

function getSteamcmdLoginCredentials(): {
  username: string
  password: string
} | undefined {
  const username = process.env.STEAMCMD_USERNAME?.trim() ?? ''
  const password = process.env.STEAMCMD_PASSWORD?.trim() ?? ''
  if (!username || !password) {
    return undefined
  }
  return {
    username,
    password,
  }
}

function sanitizePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      if (code < 32 || /[<>:"/\\|?*]/.test(char)) {
        return '-'
      }
      return char
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+$/, '')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'default-instance'
}

async function getDefaultSteamInstallPath(gameCode: string, instanceId: string): Promise<string> {
  const safeGameCode = sanitizePathSegment(gameCode)
  const safeInstanceId = sanitizePathSegment(instanceId)
  const systemConfig = await getSystemSteamcmdConfig()
  const installRoot = resolveEffectiveInstallRoot(systemConfig?.installRoot, systemConfig?.steamcmdPath)
  return path.resolve(installRoot, safeGameCode, safeInstanceId)
}

function resolveSteamcmdByCommand(commandPath: string): string {
  if (!commandPath.trim()) {
    return ''
  }
  const command = process.platform === 'win32'
    ? `$cmd = Get-Command "${commandPath}" -ErrorAction SilentlyContinue; if ($cmd) { $cmd.Source }`
    : `command -v "${commandPath}" 2>/dev/null`
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh'
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-lc', command]
  const result = spawnSync(shell, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 1_500,
    windowsHide: true,
  })
  if (result.status !== 0) {
    return ''
  }
  return result.stdout?.trim() || ''
}

function resolveDefaultInstallRoot(steamcmdCommandPath: string): string {
  const resolvedSteamcmdPath = resolveSteamcmdByCommand(steamcmdCommandPath)
  if (resolvedSteamcmdPath) {
    return path.resolve(path.dirname(resolvedSteamcmdPath), 'instances')
  }
  return process.platform === 'win32'
    ? 'C:\\steamcmd\\instances'
    : '/var/lib/game-server-hub/instances'
}

function resolveEffectiveInstallRoot(rawInstallRoot: string | undefined, rawSteamcmdPath: string | undefined): string {
  const installRoot = rawInstallRoot?.trim() || ''
  const steamcmdPath = rawSteamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
  if (!installRoot) {
    return resolveDefaultInstallRoot(steamcmdPath)
  }
  if (path.resolve(installRoot) === LEGACY_DEFAULT_INSTALL_ROOT) {
    return resolveDefaultInstallRoot(steamcmdPath)
  }
  return installRoot
}

function checkSteamcmdInstalled(commandPath: string): boolean {
  const normalizedCommand = commandPath.trim()
  if (!normalizedCommand) {
    return false
  }
  const command = process.platform === 'win32'
    ? `Get-Command "${normalizedCommand}" -ErrorAction SilentlyContinue | Out-Null`
    : `command -v "${normalizedCommand}" >/dev/null 2>&1`
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh'
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-lc', command]
  const result = spawnSync(shell, args, {
    stdio: 'ignore',
    timeout: 1_500,
    windowsHide: true,
  })
  return result.status === 0
}

function ensureInstallPathDirectory(installPath: string): string | undefined {
  try {
    fs.mkdirSync(installPath, { recursive: true })
  }
  catch (error) {
    return error instanceof Error ? error.message : '创建安装目录失败'
  }
}

function runSteamcmdAppUpdate(
  steamcmdCommand: string,
  installPath: string,
  gameCode: string,
  credentials?: { username: string, password: string },
): {
  ok: boolean
  message: string
} {
  const normalizedSteamcmdCommand = steamcmdCommand.trim()
  const normalizedGameCode = gameCode.trim()
  if (!normalizedSteamcmdCommand || !normalizedGameCode) {
    return {
      ok: false,
      message: 'SteamCMD 命令或游戏代号为空，无法执行安装',
    }
  }
  const buildSteamcmdArgs = (loginArgs: string[]) => ([
    '+@ShutdownOnFailedCommand',
    '1',
    '+@NoPromptForPassword',
    '1',
    '+force_install_dir',
    installPath,
    ...loginArgs,
    '+app_update',
    normalizedGameCode,
    'validate',
    '+quit',
  ])
  const isShellScript = process.platform !== 'win32' && normalizedSteamcmdCommand.endsWith('.sh')
  const command = isShellScript ? 'sh' : normalizedSteamcmdCommand
  const runInstall = (loginArgs: string[]) => {
    const steamcmdArgs = buildSteamcmdArgs(loginArgs)
    const args = isShellScript ? [normalizedSteamcmdCommand, ...steamcmdArgs] : steamcmdArgs
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: STEAMCMD_APP_UPDATE_TIMEOUT_MS,
      windowsHide: true,
    })
    const combinedOutput = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim()
    const compactOutput = combinedOutput
      .split(/\r?\n/)
      .slice(-20)
      .join('\n')
    return {
      ok: result.status === 0,
      output: compactOutput || 'SteamCMD app_update 执行失败',
    }
  }

  // 默认优先匿名，兼容绝大多数 dedicated server appid。
  const anonymousResult = runInstall(['+login', 'anonymous'])
  if (anonymousResult.ok) {
    return {
      ok: true,
      message: anonymousResult.output || 'SteamCMD app_update 执行完成（anonymous）',
    }
  }

  if (!credentials) {
    return {
      ok: false,
      message: anonymousResult.output,
    }
  }

  const accountResult = runInstall(['+login', credentials.username, credentials.password])
  if (accountResult.ok) {
    return {
      ok: true,
      message: accountResult.output || 'SteamCMD app_update 执行完成（account）',
    }
  }

  return {
    ok: false,
    message: `anonymous 与账号登录均失败。\n--- anonymous ---\n${anonymousResult.output}\n--- account ---\n${accountResult.output}`,
  }
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

async function runSteamcmdAppUpdateStreaming(
  steamcmdCommand: string,
  installPath: string,
  appId: string,
  loginArgs: string[],
  onLogLine?: (line: string) => void,
): Promise<{
  ok: boolean
  output: string
}> {
  const normalizedSteamcmdCommand = steamcmdCommand.trim()
  const isShellScript = process.platform !== 'win32' && normalizedSteamcmdCommand.endsWith('.sh')
  const command = isShellScript ? 'sh' : normalizedSteamcmdCommand
  const steamcmdArgs = buildSteamcmdArgs(installPath, appId, loginArgs)
  const args = isShellScript ? [normalizedSteamcmdCommand, ...steamcmdArgs] : steamcmdArgs
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logLines: string[] = []
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let resolved = false
  const timeout = setTimeout(() => {
    child.kill('SIGKILL')
  }, STEAMCMD_APP_UPDATE_TIMEOUT_MS)

  const pushLine = (line: string) => {
    const text = line.trim()
    if (!text) {
      return
    }
    logLines.push(text)
    if (logLines.length > 80) {
      logLines.shift()
    }
    onLogLine?.(text)
  }

  const consumeChunk = (chunk: Buffer, isStdout: boolean) => {
    const text = chunk.toString()
    let buffer = (isStdout ? stdoutBuffer : stderrBuffer) + text
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      pushLine(line)
    }
    if (isStdout) {
      stdoutBuffer = buffer
    }
    else {
      stderrBuffer = buffer
    }
  }

  child.stdout?.on('data', (chunk) => {
    consumeChunk(chunk as Buffer, true)
  })
  child.stderr?.on('data', (chunk) => {
    consumeChunk(chunk as Buffer, false)
  })

  return await new Promise((resolve) => {
    const finalize = (ok: boolean, fallbackMessage: string) => {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timeout)
      if (stdoutBuffer.trim()) {
        pushLine(stdoutBuffer)
      }
      if (stderrBuffer.trim()) {
        pushLine(stderrBuffer)
      }
      resolve({
        ok,
        output: logLines.slice(-20).join('\n') || fallbackMessage,
      })
    }
    child.on('error', (error) => {
      finalize(false, error.message)
    })
    child.on('close', (code) => {
      finalize(code === 0, 'SteamCMD app_update 执行失败')
    })
  })
}

async function installInstanceFilesInBackground(
  app: FastifyInstance,
  input: {
    instanceId: string
    appId: string
    instanceName: string
    gamePort?: number | null
    installPath: string
    steamcmdCommand: string
    steamcmdCredentials?: { username: string, password: string }
  },
) {
  const installLogLines: string[] = []
  const appendInstallLog = (line: string) => {
    const text = line.trim()
    if (!text) {
      return
    }
    installLogLines.push(text)
    if (installLogLines.length > 500) {
      installLogLines.shift()
    }
  }
  const persistInstallLog = (status: InstanceInstallLogSnapshot['status']) => {
    instanceInstallLogMap.set(input.instanceId, {
      instanceId: input.instanceId,
      status,
      content: installLogLines.join('\n'),
      updatedAt: new Date().toISOString(),
    })
  }
  const updateProgress = async (line: string) => {
    appendInstallLog(line)
    persistInstallLog('running')
    const progressMatch = line.match(/\[\s*(\d+)%\]/)
    const progressText = progressMatch
      ? `安装进度 ${Math.min(100, Number(progressMatch[1]))}%`
      : line
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: progressText,
      lastError: null,
    })
  }

  try {
    appendInstallLog('安装任务启动')
    persistInstallLog('running')
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: '正在准备安装...',
      lastError: null,
    })

    const anonymousResult = await runSteamcmdAppUpdateStreaming(
      input.steamcmdCommand,
      input.installPath,
      input.appId,
      ['+login', 'anonymous'],
      line => void updateProgress(line),
    )
    if (anonymousResult.ok) {
      appendInstallLog('安装完成（anonymous）')
      const startScriptResult = ensureInstanceStartScripts(input.installPath, input.appId, {
        instanceName: input.instanceName,
        gamePort: input.gamePort,
      })
      if (startScriptResult.ok) {
        appendInstallLog('启动脚本已生成')
      }
      else {
        appendInstallLog(`启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`)
      }
      persistInstallLog('success')
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'stopped',
        lastCommand: startScriptResult.ok
          ? '安装完成（anonymous），启动脚本已生成'
          : `安装完成（anonymous），启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`,
        lastError: startScriptResult.ok ? null : startScriptResult.message ?? null,
      })
      return
    }

    if (!input.steamcmdCredentials) {
      appendInstallLog(`安装失败（anonymous）：${anonymousResult.output}`)
      persistInstallLog('failed')
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'error',
        lastCommand: null,
        lastError: `安装失败（anonymous）：${anonymousResult.output}`,
      })
      return
    }

    await updateGameInstanceRuntime(input.instanceId, {
      status: 'installing',
      lastCommand: 'anonymous 失败，正在尝试账号登录重试...',
      lastError: null,
    })
    appendInstallLog('anonymous 失败，正在尝试账号登录重试...')

    const accountResult = await runSteamcmdAppUpdateStreaming(
      input.steamcmdCommand,
      input.installPath,
      input.appId,
      ['+login', input.steamcmdCredentials.username, input.steamcmdCredentials.password],
      line => void updateProgress(line),
    )
    if (accountResult.ok) {
      appendInstallLog('安装完成（account）')
      const startScriptResult = ensureInstanceStartScripts(input.installPath, input.appId, {
        instanceName: input.instanceName,
        gamePort: input.gamePort,
      })
      if (startScriptResult.ok) {
        appendInstallLog('启动脚本已生成')
      }
      else {
        appendInstallLog(`启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`)
      }
      persistInstallLog('success')
      await updateGameInstanceRuntime(input.instanceId, {
        status: 'stopped',
        lastCommand: startScriptResult.ok
          ? '安装完成（account），启动脚本已生成'
          : `安装完成（account），启动脚本生成失败: ${startScriptResult.message ?? '未知错误'}`,
        lastError: startScriptResult.ok ? null : startScriptResult.message ?? null,
      })
      return
    }

    appendInstallLog(`安装失败。\n--- anonymous ---\n${anonymousResult.output}\n--- account ---\n${accountResult.output}`)
    persistInstallLog('failed')
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'error',
      lastCommand: null,
      lastError: `安装失败。\n--- anonymous ---\n${anonymousResult.output}\n--- account ---\n${accountResult.output}`,
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : '安装任务异常中断'
    appendInstallLog(message)
    persistInstallLog('failed')
    app.log.error({
      instanceId: input.instanceId,
      installPath: input.installPath,
      message,
    }, '实例后台安装失败')
    await updateGameInstanceRuntime(input.instanceId, {
      status: 'error',
      lastCommand: null,
      lastError: message,
    })
  }
}

function validateInstallPath(rawPath: string): string | undefined {
  if (!rawPath) {
    return '安装路径不能为空'
  }
  if (!path.isAbsolute(rawPath)) {
    return '安装路径必须为绝对路径'
  }
  if (/[\0`$;&|]/.test(rawPath)) {
    return '安装路径包含危险字符'
  }
  const normalized = path.normalize(rawPath)
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  if (segments.includes('..')) {
    return '安装路径不能包含上级目录跳转'
  }
  const resolved = path.resolve(normalized)
  const root = path.parse(resolved).root
  if (resolved === root) {
    return '安装路径不能为磁盘根目录'
  }
  if (process.platform === 'win32') {
    const blocked = DANGEROUS_WINDOWS_PATHS.map((item) => {
      return path.resolve(root, item).toLowerCase()
    })
    const resolvedLower = resolved.toLowerCase()
    if (blocked.some(item => resolvedLower === item || resolvedLower.startsWith(`${item}\\`))) {
      return '安装路径命中过滤规则，请使用业务目录'
    }
  }
}

const DST_APP_ID = '343050'
const DST_CLUSTER_NAME = 'Cluster_1'
const DST_CONF_DIR = 'DoNotStarveTogether'
const DST_STORAGE_DIR = 'klei-storage'
const DST_DEFAULT_GAME_PORT = 10999

interface DstServerBinary {
  binDir: string
  executable: string
}

interface EnsureStartScriptInput {
  instanceName?: string
  gamePort?: number | null
}

function writeFileIfMissing(filePath: string, content: string) {
  if (fs.existsSync(filePath)) {
    return
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function findDstServerBinary(installPath: string): DstServerBinary | undefined {
  const candidates = process.platform === 'win32'
    ? [
        { binDir: 'bin64', executable: 'dontstarve_dedicated_server_nullrenderer_x64.exe' },
        { binDir: 'bin', executable: 'dontstarve_dedicated_server_nullrenderer.exe' },
      ]
    : [
        { binDir: 'bin64', executable: 'dontstarve_dedicated_server_x64' },
        { binDir: 'bin64', executable: 'dontstarve_dedicated_server_nullrenderer_x64' },
        { binDir: 'bin', executable: 'dontstarve_dedicated_server_nullrenderer' },
      ]
  for (const candidate of candidates) {
    const executablePath = path.join(installPath, candidate.binDir, candidate.executable)
    if (fs.existsSync(executablePath)) {
      return candidate
    }
  }
}

function ensureDstSteamAppId(installPath: string, binary: DstServerBinary) {
  const appIdContent = '322330\n'
  writeFileIfMissing(path.join(installPath, binary.binDir, 'steam_appid.txt'), appIdContent)
  writeFileIfMissing(path.join(installPath, 'steam_appid.txt'), appIdContent)
}

function buildDstClusterIni(clusterName: string) {
  const safeClusterName = clusterName.replace(/[\r\n"]/g, ' ').trim() || 'Game Server Hub'
  return [
    '[NETWORK]',
    `cluster_name = ${safeClusterName}`,
    'cluster_description = Generated by Game Server Hub',
    'cluster_password =',
    'offline_cluster = true',
    'lan_only_cluster = true',
    'whitelist_slots = 0',
    'cluster_intention = cooperative',
    'autosaver_enabled = true',
    '',
    '[GAMEPLAY]',
    'game_mode = survival',
    'max_players = 6',
    'pvp = false',
    'pause_when_empty = true',
    '',
    '[MISC]',
    'console_enabled = true',
    '',
    '[SHARD]',
    'shard_enabled = false',
    '',
  ].join('\n')
}

function buildDstMasterServerIni(gamePort: number) {
  return [
    '[SHARD]',
    'is_master = true',
    '',
    '[NETWORK]',
    `server_port = ${gamePort}`,
    '',
    '[STEAM]',
    'master_server_port = 12346',
    'authentication_port = 8766',
    '',
    '[ACCOUNT]',
    'encode_user_path = true',
    '',
  ].join('\n')
}

function buildDstWorldgenOverride() {
  return [
    'return {',
    '  override_enabled = true,',
    '  preset = "SURVIVAL_TOGETHER",',
    '  overrides = {},',
    '}',
    '',
  ].join('\n')
}

function ensureDstClusterConfig(installPath: string, input: EnsureStartScriptInput) {
  const storageRoot = path.join(installPath, DST_STORAGE_DIR)
  const clusterRoot = path.join(storageRoot, DST_CONF_DIR, DST_CLUSTER_NAME)
  const masterRoot = path.join(clusterRoot, 'Master')
  const gamePort = input.gamePort ?? DST_DEFAULT_GAME_PORT
  writeFileIfMissing(path.join(clusterRoot, 'cluster.ini'), buildDstClusterIni(input.instanceName ?? 'Game Server Hub'))
  writeFileIfMissing(path.join(masterRoot, 'server.ini'), buildDstMasterServerIni(gamePort))
  writeFileIfMissing(path.join(masterRoot, 'worldgenoverride.lua'), buildDstWorldgenOverride())
  return storageRoot
}

function buildDstStartScriptContent(binary: DstServerBinary): string {
  if (process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      `cd /d "%~dp0${binary.binDir}"`,
      `${binary.executable} -persistent_storage_root "%~dp0${DST_STORAGE_DIR}" -conf_dir ${DST_CONF_DIR} -cluster ${DST_CLUSTER_NAME} -shard Master -console`,
      '',
    ].join('\r\n')
  }
  return [
    '#!/bin/sh',
    'set -e',
    'ROOT="$(cd "$(dirname "$0")" && pwd)"',
    `cd "$ROOT/${binary.binDir}"`,
    `exec "./${binary.executable}" \\`,
    `  -persistent_storage_root "$ROOT/${DST_STORAGE_DIR}" \\`,
    `  -conf_dir ${DST_CONF_DIR} \\`,
    `  -cluster ${DST_CLUSTER_NAME} \\`,
    '  -shard Master \\',
    '  -console',
    '',
  ].join('\n')
}

function ensureDstStartScripts(installPath: string, input: EnsureStartScriptInput): {
  ok: boolean
  message?: string
} {
  const binary = findDstServerBinary(installPath)
  if (!binary) {
    return {
      ok: false,
      message: '未在安装目录找到饥荒联机服务端可执行文件（bin64/bin），请确认 SteamCMD 安装已完成',
    }
  }
  ensureDstSteamAppId(installPath, binary)
  ensureDstClusterConfig(installPath, input)
  const scriptName = process.platform === 'win32' ? 'start.cmd' : 'start.sh'
  const scriptPath = path.join(installPath, scriptName)
  if (!fs.existsSync(scriptPath)) {
    const content = buildDstStartScriptContent(binary)
    fs.writeFileSync(scriptPath, content, 'utf8')
    if (process.platform !== 'win32') {
      fs.chmodSync(scriptPath, 0o755)
    }
  }
  return { ok: true }
}

function ensureInstanceStartScripts(
  installPath: string,
  gameCode: string,
  input: EnsureStartScriptInput,
): {
  ok: boolean
  message?: string
} {
  if (gameCode.trim() === DST_APP_ID) {
    return ensureDstStartScripts(installPath, input)
  }
  if (resolveStartCommand(installPath)) {
    return { ok: true }
  }
  return {
    ok: false,
    message: '安装目录缺少启动脚本（支持 start.cmd/start.bat/start.ps1/start.sh）',
  }
}

interface InstanceLaunchSpec {
  command: string
  args: string[]
  cwd: string
  display: string
}

function resolveDstManagedLaunch(installPath: string, input: EnsureStartScriptInput): InstanceLaunchSpec | undefined {
  const binary = findDstServerBinary(installPath)
  if (!binary) {
    return undefined
  }
  const storageRoot = ensureDstClusterConfig(installPath, input)
  const binDir = path.join(installPath, binary.binDir)
  const executablePath = path.join(binDir, binary.executable)
  const args = [
    '-persistent_storage_root',
    storageRoot,
    '-conf_dir',
    DST_CONF_DIR,
    '-cluster',
    DST_CLUSTER_NAME,
    '-shard',
    'Master',
    '-console',
  ]
  return {
    command: executablePath,
    args,
    cwd: binDir,
    display: `${binary.executable} ${args.join(' ')}`,
  }
}

function resolveScriptLaunch(installPath: string): InstanceLaunchSpec | undefined {
  const commandCandidates = process.platform === 'win32'
    ? [
        { script: 'start.cmd', command: 'cmd', args: ['/d', '/s', '/c', 'start.cmd'] },
        { script: 'start.bat', command: 'cmd', args: ['/d', '/s', '/c', 'start.bat'] },
        { script: 'start.ps1', command: 'powershell', args: ['-ExecutionPolicy', 'Bypass', '-File', 'start.ps1'] },
      ]
    : [
        { script: 'start.sh', command: 'sh', args: ['start.sh'] },
      ]
  for (const candidate of commandCandidates) {
    if (fs.existsSync(path.join(installPath, candidate.script))) {
      return {
        command: candidate.command,
        args: candidate.args,
        cwd: installPath,
        display: [candidate.command, ...candidate.args].join(' '),
      }
    }
  }
}

function resolveInstanceLaunch(
  installPath: string,
  gameCode: string,
  input: EnsureStartScriptInput,
): InstanceLaunchSpec | undefined {
  if (gameCode.trim() === DST_APP_ID) {
    const managedLaunch = resolveDstManagedLaunch(installPath, input)
    if (managedLaunch) {
      return managedLaunch
    }
  }
  return resolveScriptLaunch(installPath)
}

function resolveStartCommand(installPath: string): { command: string, args: string[], display: string } | undefined {
  const launch = resolveScriptLaunch(installPath)
  if (!launch) {
    return undefined
  }
  return {
    command: launch.command,
    args: launch.args,
    display: launch.display,
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as NodeJS.ErrnoException).code)
      : ''
    if (code === 'ESRCH') {
      return false
    }
    return true
  }
}

function isInstanceProcessAlive(instanceId: string, runtimePid: number | null | undefined): boolean {
  const registryProcess = instanceRuntimeRegistry.getProcess(instanceId)
  if (registryProcess && !registryProcess.killed && registryProcess.pid && isPidAlive(registryProcess.pid)) {
    return true
  }
  if (runtimePid && isPidAlive(runtimePid)) {
    return true
  }
  return false
}

/**
 * 服务重启后内存注册表会清空，但 DB 可能仍保留 running。
 * 将已无对应进程的实例同步为 stopped，避免 UI 误显示「运行中」。
 */
async function reconcileStaleRunningInstances(app: FastifyInstance): Promise<number> {
  const instances = await listGameInstances({ status: 'running' })
  let reconciled = 0
  for (const instance of instances) {
    if (instance.nodeId !== LOCAL_NODE_ID) {
      continue
    }
    if (isInstanceProcessAlive(instance.id, instance.runtimePid)) {
      const registryProcess = instanceRuntimeRegistry.getProcess(instance.id)
      if (!registryProcess && instance.runtimePid) {
        app.log.warn({
          instanceId: instance.id,
          pid: instance.runtimePid,
        }, '实例进程仍在运行，但控制台未附着（可能因服务重启），请重启实例以恢复控制台')
      }
      continue
    }
    instanceRuntimeRegistry.deleteProcess(instance.id)
    stoppingInstanceIds.delete(instance.id)
    await updateGameInstanceRuntime(instance.id, {
      status: 'stopped',
      containerId: null,
      runtimePid: null,
    })
    reconciled++
    app.log.info({ instanceId: instance.id }, '实例进程不存在，已同步状态为已停止')
  }
  return reconciled
}

function killProcessTree(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  }
  catch {
    try {
      process.kill(pid, 'SIGTERM')
    }
    catch {
      // ignore
    }
  }
}

async function waitForProcessExit(child: ChildProcess, timeoutMs = 3000, pid?: number): Promise<boolean> {
  const exitPromise = once(child, 'close').then(() => true).catch(() => false)
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(false)
    }, timeoutMs)
  })
  let exited = await Promise.race([exitPromise, timeoutPromise])
  if (!exited) {
    const targetPid = pid ?? child.pid
    if (targetPid) {
      killProcessTree(targetPid)
    }
    else {
      child.kill('SIGKILL')
    }
    exited = await Promise.race([
      once(child, 'close').then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => {
        setTimeout(resolve, 1500, false)
      }),
    ])
  }
  return exited
}

async function stopInstanceRuntime(input: {
  instanceId: string
  runtimePid: number
  runningProcess?: ChildProcess
}): Promise<void> {
  const { instanceId, runtimePid, runningProcess } = input
  if (!isPidAlive(runtimePid)) {
    instanceRuntimeRegistry.deleteProcess(instanceId)
    await updateGameInstanceRuntime(instanceId, {
      status: 'stopped',
      containerId: null,
      runtimePid: null,
      lastError: null,
    })
    return
  }
  killProcessTree(runtimePid)
  if (runningProcess) {
    await waitForProcessExit(runningProcess, 3000, runtimePid)
    instanceRuntimeRegistry.deleteProcess(instanceId)
  }
  if (!isPidAlive(runtimePid)) {
    stoppingInstanceIds.delete(instanceId)
    await updateGameInstanceRuntime(instanceId, {
      status: 'stopped',
      containerId: null,
      runtimePid: null,
      lastError: null,
    })
  }
}

async function handleListInstances(
  app: FastifyInstance,
  request: FastifyRequest,
  payload: InstanceListQuery,
): Promise<ApiSuccessResponse<Awaited<ReturnType<typeof listGameInstances>>> | ApiErrorResponse> {
  const authError = await verifyAuthorized(request)
  if (authError) {
    return authError
  }
  await reconcileStaleRunningInstances(app)
  const status = payload.status
  return success(await listGameInstances({
    nodeId: payload.nodeId?.trim() || undefined,
    status: status && ['pending_install', 'running', 'stopped', 'installing', 'error'].includes(status)
      ? status
      : undefined,
    keyword: payload.keyword?.trim() || undefined,
  }), request)
}

/**
 * instance 模块注册入口
 * 负责游戏实例生命周期管理（创建、启动、停止、重启、删除）。
 */
export function registerInstanceModule(app: FastifyInstance) {
  app.post('/app/instance/list', async request => handleListInstances(app, request, (request.body ?? {}) as InstanceListQuery))

  app.get('/app/instance/games', async (request): Promise<ApiSuccessResponse<InstallableGameItem[]> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    return success(INSTALLABLE_GAMES, request)
  })

  app.get('/app/instance/install-log', async (request): Promise<ApiSuccessResponse<InstallLogResponse> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const query = (request.query ?? {}) as InstallLogQuery
    const id = normalizeInstanceId(query.id)
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const installLog = instanceInstallLogMap.get(id)
    if (installLog) {
      return success<InstallLogResponse>({
        content: installLog.content || '暂无 SteamCMD 安装输出',
        status: installLog.status,
        updatedAt: installLog.updatedAt,
        source: 'install_log',
      }, request)
    }
    const instance = await getGameInstanceById(id)
    if (!instance) {
      return businessError('实例不存在', request)
    }
    const summaryLines = [instance.lastCommand, instance.lastError]
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!summaryLines) {
      return success<InstallLogResponse>({
        content: '暂无完整 SteamCMD 安装输出（Hub 重启后内存日志已丢失，且当前无状态摘要）。',
        status: 'unknown',
        updatedAt: instance.updatedAt,
        source: 'empty',
      }, request)
    }
    return success<InstallLogResponse>({
      content: [
        '【最近状态摘要，非完整 SteamCMD 输出】',
        '',
        summaryLines,
      ].join('\n'),
      status: 'unknown',
      updatedAt: instance.updatedAt,
      source: 'status_summary',
    }, request)
  })

  app.post('/app/instance/create', async (request): Promise<ApiSuccessResponse<Awaited<ReturnType<typeof createGameInstance>>> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as CreateInstanceBody
    const nodeId = body.nodeId?.trim() ?? ''
    const name = body.name?.trim() ?? ''
    const gameCode = body.gameCode?.trim() ?? ''
    const manualInstallPath = normalizeInstallPath(body.installPath)
    if (!nodeId) {
      return businessError('请选择节点', request)
    }
    if (!name) {
      return businessError('实例名称不能为空', request)
    }
    if (!gameCode) {
      return businessError('请选择游戏 AppID', request)
    }
    const selectedGame = resolveInstallableGameByAppId(gameCode)
    if (!selectedGame) {
      return businessError('游戏 AppID 不在可安装列表中', request)
    }
    const steamcmdCredentials = getSteamcmdLoginCredentials()
    const steamcmdConfig = await getSystemSteamcmdConfig()
    const steamcmdCommand = steamcmdConfig?.steamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
    if (!checkSteamcmdInstalled(steamcmdCommand)) {
      return businessError('SteamCMD 未安装或路径不可用，请先完成 SteamCMD 安装配置', request)
    }
    const instanceId = randomUUID()
    const installPath = manualInstallPath || await getDefaultSteamInstallPath(gameCode, instanceId)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    const node = await getServerNodeById(nodeId)
    if (!node) {
      return businessError('节点不存在', request)
    }
    const ensureDirError = ensureInstallPathDirectory(installPath)
    if (ensureDirError) {
      return businessError(`安装目录创建失败: ${ensureDirError}`, request)
    }
    if (!manualInstallPath) {
      app.log.info({
        nodeId,
        gameCode: selectedGame.appId,
        installPath,
      }, '创建实例未填写安装目录，已回退到默认 SteamCMD 路径')
    }
    app.log.info({
      instanceId,
      gameCode,
      installPath,
      steamcmdCommand,
    }, '实例已创建，后台开始执行 SteamCMD 安装')
    const instance = await createGameInstance({
      id: instanceId,
      nodeId,
      name,
      gameCode,
      status: 'pending_install',
      installPath,
      configPath: body.configPath?.trim() || null,
      queryPort: normalizePort(body.queryPort),
      gamePort: normalizePort(body.gamePort),
      rconPort: normalizePort(body.rconPort),
      lastExitCode: null,
      lastCommand: '等待安装任务启动',
      lastError: null,
    })
    void installInstanceFilesInBackground(app, {
      instanceId,
      appId: gameCode,
      instanceName: name,
      gamePort: normalizePort(body.gamePort),
      installPath,
      steamcmdCommand,
      steamcmdCredentials,
    })
    return success(instance, request)
  })

  app.post('/app/instance/start', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    if (current.status === 'pending_install' || current.status === 'installing') {
      return businessError('实例正在安装中，请稍后重试启动', request)
    }
    const installPath = normalizeInstallPath(current.installPath ?? undefined) || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: installPathError,
      })
      return businessError(installPathError, request)
    }
    const ensureDirError = ensureInstallPathDirectory(installPath)
    if (ensureDirError) {
      const errorMessage = `安装目录创建失败: ${ensureDirError}`
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (!fs.existsSync(installPath)) {
      const steamcmdCredentials = getSteamcmdLoginCredentials()
      const steamcmdConfig = await getSystemSteamcmdConfig()
      const steamcmdCommand = steamcmdConfig?.steamcmdPath?.trim() || (process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd')
      if (!checkSteamcmdInstalled(steamcmdCommand)) {
        const errorMessage = 'SteamCMD 未安装或路径不可用，请先完成 SteamCMD 安装配置'
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: errorMessage,
        })
        return businessError(errorMessage, request)
      }
      app.log.warn({
        instanceId: id,
        installPath,
      }, '检测到安装目录不存在，尝试自动补装')
      const installResult = runSteamcmdAppUpdate(steamcmdCommand, installPath, current.gameCode, steamcmdCredentials)
      if (!installResult.ok) {
        const errorMessage = `安装路径不存在，自动补装失败: ${installResult.message}`
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: errorMessage,
        })
        return businessError(errorMessage, request)
      }
    }
    let installPathStat: fs.Stats
    try {
      installPathStat = fs.statSync(installPath)
    }
    catch {
      const errorMessage = `安装路径不存在或不可访问: ${installPath}`
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (!installPathStat.isDirectory()) {
      const errorMessage = `安装路径不是目录: ${installPath}`
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    if (!resolveInstanceLaunch(installPath, current.gameCode, {
      instanceName: current.name,
      gamePort: current.gamePort,
    })) {
      const ensureResult = ensureInstanceStartScripts(installPath, current.gameCode, {
        instanceName: current.name,
        gamePort: current.gamePort,
      })
      if (!ensureResult.ok) {
        const errorMessage = ensureResult.message ?? '安装目录缺少启动脚本（支持 start.cmd/start.bat/start.ps1/start.sh）'
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: errorMessage,
        })
        return businessError(errorMessage, request)
      }
    }
    const launch = resolveInstanceLaunch(installPath, current.gameCode, {
      instanceName: current.name,
      gamePort: current.gamePort,
    })
    if (!launch) {
      const errorMessage = '安装目录缺少启动脚本（支持 start.cmd/start.bat/start.ps1/start.sh）'
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: errorMessage,
      })
      return businessError(errorMessage, request)
    }
    const runningProcess = instanceRuntimeRegistry.getProcess(id)
    if (isInstanceProcessAlive(id, current.runtimePid)) {
      if (runningProcess && !runningProcess.killed && runningProcess.pid && isPidAlive(runningProcess.pid)) {
        return success({ isSuccess: true }, request)
      }
      return businessError('实例进程仍在运行，但面板未附着控制台，请先停止或重启实例', request)
    }
    if (runningProcess) {
      instanceRuntimeRegistry.deleteProcess(id)
    }
    if (current.status === 'running') {
      await updateGameInstanceRuntime(id, {
        status: 'stopped',
        containerId: null,
        runtimePid: null,
      })
    }
    const displayCommand = launch.display
    app.log.info({
      instanceId: id,
      installPath,
      cwd: launch.cwd,
      command: displayCommand,
    }, '开始启动实例')
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    instanceRuntimeRegistry.setProcess(id, child)
    stoppingInstanceIds.delete(id)
    child.on('error', (error) => {
      instanceRuntimeRegistry.deleteProcess(id)
      app.log.error({
        instanceId: id,
        command: displayCommand,
        error: error.message,
      }, '实例启动失败')
      void updateGameInstanceRuntime(id, {
        status: 'error',
        containerId: null,
        runtimePid: null,
        lastCommand: displayCommand,
        lastError: error.message,
      })
    })
    child.on('close', (code, signal) => {
      const stderrText = instanceRuntimeRegistry.listLogs(id)
        .filter(line => line.stream === 'stderr')
        .slice(-20)
        .map(line => line.text)
        .join('\n')
        .trim()
      instanceRuntimeRegistry.deleteProcess(id)
      const wasStopping = stoppingInstanceIds.delete(id)
      const finalError = wasStopping
        ? null
        : stderrText || (code === 0 ? null : `实例异常退出，信号=${signal ?? 'none'}，退出码=${code ?? 'null'}（若曾出现系统安全弹窗，请确认已允许运行）`)
      app.log.info({
        instanceId: id,
        command: displayCommand,
        exitCode: code,
        signal,
        wasStopping,
        error: finalError,
      }, '实例进程退出')
      void updateGameInstanceRuntime(id, {
        status: wasStopping ? 'stopped' : (code === 0 ? 'stopped' : 'error'),
        containerId: null,
        runtimePid: null,
        lastCommand: displayCommand,
        lastExitCode: code === null ? null : code,
        lastError: finalError,
      })
    })
    await updateGameInstanceRuntime(id, {
      status: 'running',
      containerId: child.pid ? String(child.pid) : null,
      runtimePid: child.pid ?? null,
      lastCommand: displayCommand,
      lastExitCode: null,
      lastError: null,
    })
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/stop', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    if (current.status === 'stopped') {
      return success({ isSuccess: true }, request)
    }
    const runningProcess = instanceRuntimeRegistry.getProcess(id)
    const runtimePid = runningProcess?.pid ?? current.runtimePid
    if (!runtimePid) {
      await updateGameInstanceRuntime(id, {
        status: 'stopped',
        containerId: null,
        runtimePid: null,
        lastError: null,
      })
      return success({ isSuccess: true }, request)
    }
    try {
      stoppingInstanceIds.add(id)
      app.log.info({
        instanceId: id,
        pid: runtimePid,
      }, '实例停止命令已发送')
      await stopInstanceRuntime({
        instanceId: id,
        runtimePid,
        runningProcess,
      })
    }
    catch (error) {
      stoppingInstanceIds.delete(id)
      const message = error instanceof Error ? error.message : '停止实例失败'
      app.log.error({
        instanceId: id,
        pid: runtimePid,
        error: message,
      }, '实例停止失败')
      await updateGameInstanceRuntime(id, {
        status: 'error',
        lastError: message,
      })
      return businessError(message, request)
    }
    return success({ isSuccess: true }, request)
  })

  app.post('/app/instance/restart', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    const runningProcess = instanceRuntimeRegistry.getProcess(id)
    const runtimePid = runningProcess?.pid ?? current.runtimePid
    if (runtimePid) {
      stoppingInstanceIds.add(id)
      try {
        await stopInstanceRuntime({
          instanceId: id,
          runtimePid,
          runningProcess,
        })
      }
      catch (error) {
        stoppingInstanceIds.delete(id)
        const message = error instanceof Error ? error.message : '重启时停止实例失败'
        await updateGameInstanceRuntime(id, {
          status: 'error',
          lastError: message,
        })
        return businessError(message, request)
      }
    }
    return app.inject({
      method: 'POST',
      url: '/app/instance/start',
      headers: {
        token: normalizeToken(request.headers.token),
      },
      payload: {
        id,
      },
    }).then((response) => {
      if (response.statusCode >= 400) {
        return businessError('实例重启失败', request)
      }
      const payload = JSON.parse(response.body) as ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse
      if ('error' in payload && payload.error) {
        return businessError(payload.error, request)
      }
      return success({ isSuccess: true }, request)
    })
  })

  app.post('/app/instance/delete', async (request): Promise<ApiSuccessResponse<{ isSuccess: boolean }> | ApiErrorResponse> => {
    const authError = await verifyAuthorized(request)
    if (authError) {
      return authError
    }
    const body = (request.body ?? {}) as InstanceActionBody
    const id = normalizeInstanceId(body.id)
    if (!id) {
      return businessError('实例 ID 不能为空', request)
    }
    const current = await getGameInstanceById(id)
    if (!current) {
      return businessError('实例不存在', request)
    }
    if (current.nodeId !== LOCAL_NODE_ID) {
      return businessError('当前仅支持本地节点执行实例命令', request)
    }
    const runningProcess = instanceRuntimeRegistry.getProcess(id)
    const runtimePid = runningProcess?.pid ?? current.runtimePid
    if (runtimePid && isPidAlive(runtimePid)) {
      stoppingInstanceIds.add(id)
      try {
        app.log.info({
          instanceId: id,
          pid: runtimePid,
        }, '删除实例前自动停止运行中的进程')
        await stopInstanceRuntime({
          instanceId: id,
          runtimePid,
          runningProcess,
        })
      }
      catch (error) {
        stoppingInstanceIds.delete(id)
        const message = error instanceof Error ? error.message : '删除前停止实例失败'
        return businessError(message, request)
      }
    }
    else if (current.status === 'running') {
      instanceRuntimeRegistry.deleteProcess(id)
      stoppingInstanceIds.delete(id)
      await updateGameInstanceRuntime(id, {
        status: 'stopped',
        containerId: null,
        runtimePid: null,
        lastError: null,
      })
    }
    instanceRuntimeRegistry.deleteProcess(id)
    instanceInstallLogMap.delete(id)
    stoppingInstanceIds.delete(id)
    const installPath = normalizeInstallPath(current.installPath ?? undefined)
      || await getDefaultSteamInstallPath(current.gameCode, current.id)
    const installPathError = validateInstallPath(installPath)
    if (installPathError) {
      return businessError(installPathError, request)
    }
    if (fs.existsSync(installPath)) {
      try {
        fs.rmSync(installPath, {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 200,
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : '删除实例目录失败'
        return businessError(`删除实例目录失败: ${message}`, request)
      }
    }
    const deleted = await deleteGameInstanceById(id)
    if (!deleted) {
      return businessError('实例不存在', request)
    }
    return success({ isSuccess: true }, request)
  })

  app.addHook('onReady', async () => {
    const reconciled = await reconcileStaleRunningInstances(app)
    if (reconciled > 0) {
      app.log.info({ reconciled }, '已校正因服务重启而残留的实例运行状态')
    }
  })
}
