/** DST 在线人数等能力所需的容器控制台端口（由 instance 模块在启动时注册） */
export interface DstContainerCommandPort {
  isInstanceContainerRunning: (instanceId: string) => Promise<boolean>
  readRecentInstanceContainerLogLines: (instanceId: string, limit: number) => Promise<string[]>
  sendInstanceContainerCommand: (
    instanceId: string,
    command: string,
    shard: 'master' | 'caves',
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
