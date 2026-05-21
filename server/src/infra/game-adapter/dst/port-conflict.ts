import dgram from 'node:dgram'
import type { ServerIniFields } from './server-ini'
import { collectPortSet } from './server-ini'

function isUdpPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', (err: NodeJS.ErrnoException) => {
      socket.close()
      if (err.code === 'EADDRINUSE') {
        resolve(true)
        return
      }
      resolve(false)
    })
    socket.once('listening', () => {
      socket.close()
      resolve(false)
    })
    try {
      socket.bind(port, '0.0.0.0')
    }
    catch {
      resolve(true)
    }
  })
}

export async function findHostUdpPortConflicts(ports: number[]): Promise<number[]> {
  const unique = [...new Set(ports.filter(p => Number.isInteger(p) && p >= 1 && p <= 65535))]
  const conflicts: number[] = []
  for (const port of unique) {
    if (await isUdpPortInUse(port)) {
      conflicts.push(port)
    }
  }
  return conflicts
}

export function formatPortConflictMessage(conflicts: number[]): string {
  if (conflicts.length === 0) {
    return '端口冲突'
  }
  if (conflicts.length === 1) {
    return `端口 ${conflicts[0]} 已被占用，请修改分片配置或释放该端口后重试`
  }
  return `端口 ${conflicts.join('、')} 已被占用，请修改分片配置或释放这些端口后重试`
}

export async function validateShardPortsForStart(
  master: ServerIniFields,
  caves: ServerIniFields | null,
): Promise<string | undefined> {
  const ports = collectPortSet(master)
  if (caves) {
    ports.push(...collectPortSet(caves))
  }
  const conflicts = await findHostUdpPortConflicts(ports)
  if (conflicts.length > 0) {
    return formatPortConflictMessage(conflicts)
  }
  return undefined
}
