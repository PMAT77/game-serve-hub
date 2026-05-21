import type { ClusterNetworkMode } from './cluster'

/** POST /app/instance/console/command 目标分片 */
export type InstanceConsoleCommandShard = 'master' | 'caves'

/** 控制台命令可下发分片状态（connect-info 附带，供 UI 禁用洞穴选项） */
export interface InstanceConsoleShardStatus {
  masterRunning: boolean
  cavesConfigured: boolean
  cavesRunning: boolean
}

/** GET /app/instance/connect-info 响应体 */
export interface InstanceConnectInfoDto {
  running: boolean
  /** 公网/对外推荐直连命令 */
  command: string
  /** 游戏与服务器在同一台电脑时使用（127.0.0.1） */
  localCommand: string
  /** 局域网内其他设备使用（192.168.x.x 等，视宿主机网卡而定） */
  lanCommand: string | null
  host: string
  port: number
  /** 直连需在宿主机放行的 UDP 端口（含 Steam 辅助端口） */
  udpPorts: number[]
  roomName: string
  networkMode: ClusterNetworkMode
  networkModeLabel: string
  hasPassword: boolean
  hostSourceLabel: string
  isPlaceholder: boolean
  hints: string[]
  consoleShards: InstanceConsoleShardStatus
}
