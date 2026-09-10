import type { FastifyRequest } from 'fastify'
import process from 'node:process'
import {
  getSystemPanelSettings,
  saveSystemPanelSettings,
} from '../../shared/db/index'
import { getDefaultPanelSettings } from './defaults'

function parsePort(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null
  }
  const port = Number.parseInt(value.trim(), 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null
  }
  return port
}

function parsePortFromHost(host: string): number | null {
  const trimmed = host.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']')
    if (closingBracket === -1) {
      return null
    }
    const remainder = trimmed.slice(closingBracket + 1)
    if (!remainder.startsWith(':')) {
      return null
    }
    return parsePort(remainder.slice(1))
  }
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon <= 0) {
    return null
  }
  return parsePort(trimmed.slice(lastColon + 1))
}

export function resolveActualPanelPort(input: {
  serverPort: number
  publishedPortEnv?: string
  hostHeader?: string
  forwardedHost?: string
  forwardedPort?: string
}): number {
  const fromEnv = parsePort(input.publishedPortEnv)
  if (fromEnv) {
    return fromEnv
  }

  const fromForwardedPort = parsePort(input.forwardedPort)
  if (fromForwardedPort) {
    return fromForwardedPort
  }

  const host = input.forwardedHost?.trim() || input.hostHeader?.trim()
  if (host) {
    const fromHost = parsePortFromHost(host)
    if (fromHost) {
      return fromHost
    }
  }

  return input.serverPort
}

export function resolveActualPanelPortFromRequest(
  serverPort: number,
  request: Pick<FastifyRequest, 'headers'>,
): number {
  const headers = request.headers
  const forwardedHost = Array.isArray(headers['x-forwarded-host'])
    ? headers['x-forwarded-host'][0]
    : headers['x-forwarded-host']
  const forwardedPort = Array.isArray(headers['x-forwarded-port'])
    ? headers['x-forwarded-port'][0]
    : headers['x-forwarded-port']
  const hostHeader = Array.isArray(headers.host)
    ? headers.host[0]
    : headers.host

  return resolveActualPanelPort({
    serverPort,
    publishedPortEnv: process.env.GSH_PANEL_PUBLISHED_PORT,
    hostHeader,
    forwardedHost,
    forwardedPort,
  })
}

export interface PanelPortBootstrapSyncInput {
  mode: 'development' | 'test' | 'production'
  publishedPortEnv?: string
  existingPanelPort?: number
  defaultPanelPort: number
}

/**
 * 计算「面板端口」启动引导值，返回应写入的端口，null 表示不写。
 *
 * 仅生产部署且通过 GSH_PANEL_PUBLISHED_PORT 显式声明对外发布端口（compose 栈）时，
 * 才允许把发布端口初始化/校正进「面板端口」设置：
 * - 开发/测试环境没有"对外发布端口"语义，禁止把后端监听端口固化成面板端口（避免
 *   dev 后端 8888 / dev:compose 发布端口被误同步进设置与 panel.env 的 VITE_DEV_WEB_PORT）；
 * - 用户已显式设置过的面板端口（不等于出厂默认）永不覆盖。
 */
export function resolvePanelPortBootstrapSync(input: PanelPortBootstrapSyncInput): number | null {
  if (input.mode !== 'production') {
    return null
  }
  const publishedPort = parsePort(input.publishedPortEnv)
  if (!publishedPort) {
    return null
  }
  // 全新数据库：以实际发布端口初始化
  if (input.existingPanelPort === undefined) {
    return publishedPort
  }
  // 仍为出厂默认值：校正为实际发布端口
  if (input.existingPanelPort === input.defaultPanelPort && publishedPort !== input.defaultPanelPort) {
    return publishedPort
  }
  return null
}

export async function syncPanelPortSettingIfStale(input: {
  mode: 'development' | 'test' | 'production'
}): Promise<void> {
  const settings = await getSystemPanelSettings()
  const defaults = getDefaultPanelSettings()
  const nextPort = resolvePanelPortBootstrapSync({
    mode: input.mode,
    publishedPortEnv: process.env.GSH_PANEL_PUBLISHED_PORT,
    existingPanelPort: settings?.panelPort,
    defaultPanelPort: defaults.panelPort,
  })
  if (nextPort === null) {
    return
  }
  await saveSystemPanelSettings({
    ...(settings ?? defaults),
    panelPort: nextPort,
  })
}
