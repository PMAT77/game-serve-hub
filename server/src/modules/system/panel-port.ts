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

export async function syncPanelPortSettingIfStale(serverPort: number) {
  const actualPanelPort = resolveActualPanelPort({
    serverPort,
    publishedPortEnv: process.env.GSH_PANEL_PUBLISHED_PORT,
  })
  const settings = await getSystemPanelSettings()
  const defaults = getDefaultPanelSettings()

  if (!settings) {
    await saveSystemPanelSettings({
      ...defaults,
      panelPort: actualPanelPort,
    })
    return
  }

  if (settings.panelPort === defaults.panelPort && actualPanelPort !== defaults.panelPort) {
    await saveSystemPanelSettings({
      ...settings,
      panelPort: actualPanelPort,
    })
  }
}
