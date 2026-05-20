import fs from 'node:fs'
import path from 'node:path'
import {
  DST_CLUSTER_NAME,
  DST_CONF_DIR,
  DST_DEFAULT_GAME_PORT,
  DST_STORAGE_DIR,
} from './constants'
import { buildGameFilesBlockedMessage, diagnoseDstInstallReadiness } from './install-readiness'
import { buildClusterIni, defaultClusterIniFields } from './cluster-ini'

export interface DstServerBinary {
  binDir: string
  executable: string
}

export interface EnsureDstClusterInput {
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

export function findDstServerBinary(installPath: string): DstServerBinary | undefined {
  const candidates = listDstServerBinaryCandidates()
  for (const candidate of candidates) {
    const executablePath = path.join(installPath, candidate.binDir, candidate.executable)
    if (fs.existsSync(executablePath)) {
      return candidate
    }
  }
}

function listDstServerBinaryCandidates(): DstServerBinary[] {
  return [
    { binDir: 'bin64', executable: 'dontstarve_dedicated_server_x64' },
    { binDir: 'bin64', executable: 'dontstarve_dedicated_server_nullrenderer_x64' },
    { binDir: 'bin', executable: 'dontstarve_dedicated_server_nullrenderer' },
  ]
}

/** SteamCMD 安装后或权限修复流程可能去掉 +x，启动前补齐可执行位。 */
export function ensureDstServerBinaryExecutable(installPath: string): void {
  for (const candidate of listDstServerBinaryCandidates()) {
    const executablePath = path.join(installPath, candidate.binDir, candidate.executable)
    if (!fs.existsSync(executablePath)) {
      continue
    }
    try {
      const stat = fs.statSync(executablePath)
      fs.chmodSync(executablePath, stat.mode | 0o755)
    }
    catch {
      // best-effort
    }
  }
}

function ensureDstSteamAppId(installPath: string, binary: DstServerBinary) {
  const appIdContent = '322330\n'
  writeFileIfMissing(path.join(installPath, binary.binDir, 'steam_appid.txt'), appIdContent)
  writeFileIfMissing(path.join(installPath, 'steam_appid.txt'), appIdContent)
}

export function buildDstClusterIni(clusterName: string) {
  return buildClusterIni(defaultClusterIniFields(clusterName))
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

export function ensureDstClusterConfig(installPath: string, input: EnsureDstClusterInput) {
  const storageRoot = path.join(installPath, DST_STORAGE_DIR)
  const clusterRoot = path.join(storageRoot, DST_CONF_DIR, DST_CLUSTER_NAME)
  const masterRoot = path.join(clusterRoot, 'Master')
  const gamePort = input.gamePort ?? DST_DEFAULT_GAME_PORT
  writeFileIfMissing(path.join(clusterRoot, 'cluster.ini'), buildDstClusterIni(input.instanceName ?? 'Game Server Hub'))
  writeFileIfMissing(path.join(masterRoot, 'server.ini'), buildDstMasterServerIni(gamePort))
  writeFileIfMissing(path.join(masterRoot, 'worldgenoverride.lua'), buildDstWorldgenOverride())
  return storageRoot
}

export function ensureDstLayout(installPath: string, input: EnsureDstClusterInput): {
  ok: boolean
  message?: string
} {
  const binary = findDstServerBinary(installPath)
  if (!binary) {
    const readiness = diagnoseDstInstallReadiness(installPath)
    return {
      ok: false,
      message: buildGameFilesBlockedMessage(readiness, { instanceStatus: 'error' }),
    }
  }
  ensureDstSteamAppId(installPath, binary)
  ensureDstClusterConfig(installPath, input)
  ensureDstServerBinaryExecutable(installPath)
  return { ok: true }
}

export function buildDstLaunchArgs(storageRoot: string): string[] {
  return [
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
}
