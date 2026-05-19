/**
 * 开发 Compose 启动器：SteamCMD 前置拉取 → compose up → 就绪后打印可配置横幅
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const panelPort = process.env.PANEL_PORT?.trim() || '3000'
const webPort = process.env.VITE_DEV_WEB_PORT?.trim() || '9000'
const panelUrl = `http://127.0.0.1:${panelPort}`
const webUrl = `http://127.0.0.1:${webPort}`
const steamcmdImage = process.env.GSH_STEAMCMD_IMAGE?.trim() || 'cm2network/steamcmd:root-bookworm'
const account = process.env.ADMIN_USERNAME?.trim() || 'admin'
const password = process.env.ADMIN_PASSWORD ?? 'admin'

import { createDevComposeLogFilter, filterDevComposeLogLine } from './dev-compose-log-filter.ts'

const verboseComposeLogs = process.env.GSH_DEV_COMPOSE_VERBOSE === '1'
const READY_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 2_000

interface BannerConfig {
  panelUrlTemplate?: string
  webUrlTemplate?: string
  lines?: string[]
  template?: string
}

function runPrepare() {
  const output = execFileSync('pnpm', ['run', 'dev:compose:prepare'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (verboseComposeLogs) {
    process.stdout.write(output)
    return
  }
  for (const line of output.split(/\r?\n/)) {
    const filtered = filterDevComposeLogLine(line)
    if (filtered) {
      console.log(filtered)
    }
  }
}

function loadBannerConfig(): BannerConfig {
  const paths = [
    path.join(repoRoot, 'scripts/dev-compose.banner.local.json'),
    path.join(repoRoot, 'scripts/dev-compose.banner.json'),
  ]
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as BannerConfig
    }
  }
  return {}
}

function renderBanner(config: BannerConfig) {
  const resolvedPanelUrl = (config.panelUrlTemplate ?? 'http://localhost:{panelPort}')
    .replace(/\{panelPort\}/g, panelPort)
  const resolvedWebUrl = (config.webUrlTemplate ?? 'http://localhost:{webPort}')
    .replace(/\{webPort\}/g, webPort)

  const vars: Record<string, string> = {
    panelPort,
    webPort,
    panelUrl: resolvedPanelUrl,
    webUrl: resolvedWebUrl,
    account,
    password,
    steamcmdImage,
  }

  const substitute = (text: string) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)

  if (config.template) {
    console.log(substitute(config.template))
    return
  }

  const lines = config.lines ?? [
    '',
    `前端: ${resolvedWebUrl}`,
    `后端: ${resolvedPanelUrl}`,
    `账号: ${account}  密码: ${password}`,
    '',
  ]
  for (const line of lines) {
    console.log(substitute(line))
  }
}

async function waitForUrl(url: string, label: string): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) })
      if (res.ok || res.status < 500) {
        return true
      }
    }
    catch {
      // retry
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    process.stdout.write(`[dev:compose] 等待 ${label}…\r`)
  }
  return false
}

async function waitForPanelHealth(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${panelUrl}/health`, { signal: AbortSignal.timeout(3_000) })
      if (res.ok) {
        const json = await res.json() as { docker?: string }
        if (json.docker === 'running' || json.docker === 'stopped') {
          return true
        }
      }
    }
    catch {
      // retry
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  return false
}

let bannerPrinted = false
let bannerCheckInProgress = false

async function tryPrintReadyBanner(): Promise<boolean> {
  if (bannerPrinted || bannerCheckInProgress) {
    return bannerPrinted
  }
  bannerCheckInProgress = true
  try {
    const [panelOk, webOk] = await Promise.all([
      waitForPanelHealth(),
      waitForUrl(webUrl, '前端'),
    ])
    if (panelOk && webOk) {
      bannerPrinted = true
      renderBanner(loadBannerConfig())
      if (!verboseComposeLogs) {
        console.log('[dev:compose] 详细日志: GSH_DEV_COMPOSE_VERBOSE=1 pnpm dev:compose')
      }
    }
  }
  finally {
    if (!bannerPrinted) {
      bannerCheckInProgress = false
    }
  }
  return bannerPrinted
}

function startCompose(): Promise<number> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    const composeArgs = [
      'compose',
      '-f', 'docker-compose.yml',
      '-f', 'docker-compose.dev.yml',
      'up',
      '--build',
      '--quiet-pull',
    ]
    const child = spawn(
      isWin ? 'docker.exe' : 'docker',
      composeArgs,
      {
        cwd: repoRoot,
        stdio: verboseComposeLogs ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        shell: isWin,
      },
    )
    if (!verboseComposeLogs && child.stdout && child.stderr) {
      const emit = (line: string) => console.log(line)
      const filterStdout = createDevComposeLogFilter(emit)
      const filterStderr = createDevComposeLogFilter(emit)
      child.stdout.on('data', filterStdout)
      child.stderr.on('data', filterStderr)
    }
    const pollTimer = setInterval(() => {
      void tryPrintReadyBanner().then((printed) => {
        if (printed) {
          clearInterval(pollTimer)
        }
      })
    }, POLL_INTERVAL_MS)

    child.on('error', (error) => {
      clearInterval(pollTimer)
      reject(error)
    })
    child.on('close', (code) => {
      clearInterval(pollTimer)
      resolve(code ?? 1)
    })
  })
}

async function main() {
  runPrepare()
  if (!verboseComposeLogs) {
    console.log('[dev:compose] 启动 docker compose…')
  }
  else {
    console.log('[dev:compose] 启动 docker compose（就绪后将打印访问地址）…\n')
  }
  const exitCode = await startCompose()
  process.exit(exitCode)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
