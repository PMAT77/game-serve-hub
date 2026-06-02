import { randomBytes } from 'node:crypto'
import { getDstContainerCommandPort } from '../../../shared/instance/dst-container-command-port'
import { instanceConsoleLogStore } from '../../../shared/instance-runtime/console-log-store'

export const DST_ONLINE_PLAYER_COUNT_MARKER = 'GSH_PLAYER_COUNT:'

/** 向 DST 主世界控制台发送的 Lua 命令，在 stdout 输出带 queryToken 的可解析标记行。
 * 使用 #AllPlayers（同 c_getnumplayers），勿用 #TheNet:GetClientTable()：
 * 专用服 client 表含 performance 占位连接，会导致人数 +1。 */
export function buildDstOnlinePlayerCountCommand(queryToken: string): string {
  return `print("${DST_ONLINE_PLAYER_COUNT_MARKER}${queryToken}:" .. #AllPlayers)`
}

function createQueryToken(): string {
  return randomBytes(4).toString('hex')
}

export function parseDstOnlinePlayerCountLine(text: string, queryToken?: string): number | null {
  const tokenPart = queryToken
    ? `${queryToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`
    : ''
  const match = text.match(new RegExp(`${DST_ONLINE_PLAYER_COUNT_MARKER}${tokenPart}(\\d+)`))
  if (!match) {
    return null
  }
  const value = Number.parseInt(match[1], 10)
  if (!Number.isFinite(value) || value < 0) {
    return null
  }
  return value
}

function findOnlinePlayerCountInLines(lines: string[], queryToken: string): number | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const count = parseDstOnlinePlayerCountLine(lines[index], queryToken)
    if (count !== null) {
      return count
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function queryDstOnlinePlayerCount(
  instanceId: string,
  options?: { timeoutMs?: number, pollIntervalMs?: number },
): Promise<number | null> {
  const port = getDstContainerCommandPort()
  const running = await port.isInstanceContainerRunning(instanceId)
  if (!running) {
    return null
  }

  const queryToken = createQueryToken()
  const command = buildDstOnlinePlayerCountCommand(queryToken)
  const timeoutMs = options?.timeoutMs ?? 4000
  const pollIntervalMs = options?.pollIntervalMs ?? 150
  const logsBefore = instanceConsoleLogStore.listLogs(instanceId)
  const lastId = logsBefore.length > 0 ? logsBefore[logsBefore.length - 1].id : 0
  const dockerSnapshot = await port.readRecentInstanceContainerLogLines(instanceId, 120)

  const result = await port.sendInstanceContainerCommand(instanceId, command, 'master')
  if (!result.ok) {
    return null
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const dockerLines = await port.readRecentInstanceContainerLogLines(instanceId, 120)
    const freshDockerLines = dockerLines.filter(line => !dockerSnapshot.includes(line))
    const dockerCount = findOnlinePlayerCountInLines(freshDockerLines, queryToken)
    if (dockerCount !== null) {
      return dockerCount
    }

    const newLogs = instanceConsoleLogStore.listLogs(instanceId, lastId)
    const memoryCount = findOnlinePlayerCountInLines(newLogs.map(line => line.text), queryToken)
    if (memoryCount !== null) {
      return memoryCount
    }

    await sleep(pollIntervalMs)
  }

  return null
}
