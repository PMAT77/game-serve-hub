import fs from 'node:fs'
import type { ClusterNetworkMode } from '../../../../../shared/contracts/cluster'
import type { InstanceConnectInfoDto } from '../../../../../shared/contracts/console'
import {
  CONNECT_HOST_PLACEHOLDER,
  connectHostSourceLabel,
  resolveDstConnectHost,
  resolveLanConnectHost,
  type ResolvedConnectHost,
} from './connect-host'
import { parseClusterIni } from './cluster-ini'
import { resolveClusterPaths } from './cluster-service'
import { readMasterServerIniFields } from './shard-service'

const NETWORK_MODE_LABEL: Record<ClusterNetworkMode, string> = {
  offline: '离线',
  lan_only: '仅局域网',
  public: '公网（Klei 列表）',
}

function escapeLuaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildDstDirectConnectCommand(host: string, port: number, password?: string): string {
  const safeHost = escapeLuaString(host)
  if (password?.trim()) {
    return `c_connect("${safeHost}", ${port}, "${escapeLuaString(password.trim())}")`
  }
  return `c_connect("${safeHost}", ${port})`
}

function collectConnectHints(
  resolved: ResolvedConnectHost,
  networkMode: ClusterNetworkMode,
): string[] {
  const hints: string[] = []
  if (resolved.isPlaceholder) {
    hints.push(`未能自动探测进服地址，请将命令中的 ${CONNECT_HOST_PLACEHOLDER} 替换为服务器公网 IP`)
    hints.push('也可在面板环境配置中手动指定进服地址')
    return hints
  }
  const sourceLabel = connectHostSourceLabel(resolved.source)
  if (resolved.source === 'interface_private') {
    if (networkMode === 'public') {
      hints.push(`当前为局域网地址（${sourceLabel}），公网玩家可能无法直连；请检查云安全组/防火墙是否已放行游戏端口`)
    }
    else {
      hints.push(`连接地址为局域网 IP（${sourceLabel}），仅同一局域网内玩家可直连`)
    }
  }
  else if (resolved.source === 'env') {
    hints.push('进服地址来自手动配置')
  }
  if (networkMode === 'public' && !resolved.isPlaceholder) {
    hints.push('从游戏浏览列表进服走 Klei 中继；使用下方直连命令需在防火墙放行游戏 UDP 端口')
  }
  return hints
}

export async function buildDstConnectInfo(
  installPath: string,
  options?: { gamePort?: number | null, running?: boolean },
): Promise<Omit<InstanceConnectInfoDto, 'consoleShards'>> {
  const { clusterIniPath } = resolveClusterPaths(installPath)
  let clusterName = 'Game Server Hub'
  let clusterPassword = ''
  let networkMode: ClusterNetworkMode = 'offline'
  if (fs.existsSync(clusterIniPath)) {
    const content = fs.readFileSync(clusterIniPath, 'utf8')
    const parsed = parseClusterIni(content)
    clusterName = parsed.fields.clusterName
    clusterPassword = parsed.fields.clusterPassword
    networkMode = parsed.fields.networkMode
  }
  const masterFields = readMasterServerIniFields(installPath, options?.gamePort)
  const resolved = await resolveDstConnectHost()
  const port = masterFields.serverPort
  const password = clusterPassword.trim() || undefined
  const command = buildDstDirectConnectCommand(resolved.host, port, password)
  const localCommand = buildDstDirectConnectCommand('127.0.0.1', port, password)
  const lanHost = resolveLanConnectHost()
  const lanCommand = lanHost && lanHost !== resolved.host && lanHost !== '127.0.0.1'
    ? buildDstDirectConnectCommand(lanHost, port, password)
    : null
  const udpPorts = [
    masterFields.serverPort,
    masterFields.steamAuthPort,
    masterFields.steamMasterPort,
  ].filter((value, index, arr) => arr.indexOf(value) === index)
  const hints = collectConnectHints(resolved, networkMode)
  return {
    running: Boolean(options?.running),
    command,
    localCommand,
    lanCommand,
    host: resolved.host,
    port,
    udpPorts,
    roomName: clusterName,
    networkMode,
    networkModeLabel: NETWORK_MODE_LABEL[networkMode],
    hasPassword: Boolean(password),
    hostSourceLabel: connectHostSourceLabel(resolved.source),
    isPlaceholder: resolved.isPlaceholder,
    hints,
  }
}
