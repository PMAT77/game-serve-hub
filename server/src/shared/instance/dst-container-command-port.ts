/** DST 的地上 / 洞穴分片标识 */
export type DstConsoleShard = 'master' | 'caves'

/** DST 在线人数等能力所需的容器控制台端口（由 instance 模块在启动时注册） */
export interface DstContainerCommandPort {
  /** 指定分片的容器是否在运行；不传分片时看地上世界 */
  isInstanceContainerRunning: (instanceId: string, shard?: DstConsoleShard) => Promise<boolean>
  /**
   * 读取某一分片的最近日志行。
   *
   * 分片必须参与参数：地上与洞穴是两个独立进程，各自打印自己的标记行；
   * 不区分分片就会把两边的查询结果混在一起解析。
   */
  readRecentInstanceContainerLogLines: (instanceId: string, limit: number, shard?: DstConsoleShard) => Promise<string[]>
  sendInstanceContainerCommand: (
    instanceId: string,
    command: string,
    shard: DstConsoleShard,
    options?: { silent?: boolean },
  ) => Promise<{ ok: boolean, message?: string }>
}

let dstContainerCommandPort: DstContainerCommandPort | null = null

export function registerDstContainerCommandPort(port: DstContainerCommandPort) {
  dstContainerCommandPort = port
}

export function getDstContainerCommandPort(): DstContainerCommandPort {
  if (!dstContainerCommandPort) {
    throw new Error('DstContainerCommandPort 未注册，请确认 instance 模块已加载')
  }
  return dstContainerCommandPort
}
