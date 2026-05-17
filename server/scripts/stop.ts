import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function getArgValue(name: string): string | undefined {
  const full = `--${name}=`
  const matched = process.argv.find(item => item.startsWith(full))
  return matched?.slice(full.length)
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return undefined
  }
  return parsed
}

function readServerPortFromEnv(mode: string): number | undefined {
  const envFile = path.resolve(process.cwd(), `server/.env.${mode}`)
  if (!fs.existsSync(envFile)) {
    return undefined
  }
  const content = fs.readFileSync(envFile, 'utf8')
  const line = content
    .split('\n')
    .map(item => item.trim())
    .find(item => item.startsWith('SERVER_PORT='))
  const value = line?.split('=')[1]?.trim()
  return parsePort(value)
}

function getPort(): number {
  const mode = getArgValue('mode') ?? process.env.NODE_ENV ?? 'development'
  const argPort = parsePort(getArgValue('port'))
  if (argPort) {
    return argPort
  }
  const envPort = parsePort(process.env.SERVER_PORT)
  if (envPort) {
    return envPort
  }
  const filePort = readServerPortFromEnv(mode)
  if (filePort) {
    return filePort
  }
  return 9527
}

function getPidsByPort(port: number): number[] {
  const output = execSync(`netstat -ano | findstr :${port}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const rows = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.includes('LISTENING'))

  const pids = rows
    .map((line) => {
      const cols = line.split(/\s+/)
      const pid = Number.parseInt(cols[cols.length - 1] ?? '', 10)
      return Number.isInteger(pid) ? pid : undefined
    })
    .filter((pid): pid is number => pid !== undefined)

  return [...new Set(pids)]
}

function getWatchPids(): number[] {
  const output = execSync('Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*./server/src/main.ts*\' } | Select-Object -ExpandProperty ProcessId', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: 'powershell.exe',
  })
  return output
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => Number.parseInt(item, 10))
    .filter(pid => Number.isInteger(pid))
}

function stopByPid(pid: number, reason: string) {
  execSync(`taskkill /PID ${pid} /T /F`, {
    stdio: 'pipe',
  })
  console.log(`[server:stop] stopped pid=${pid} (${reason})`)
}

function main() {
  const port = getPort()
  let listeningPids: number[] = []
  let watchPids: number[] = []

  try {
    listeningPids = getPidsByPort(port)
  }
  catch {
    listeningPids = []
  }

  try {
    watchPids = getWatchPids()
  }
  catch {
    watchPids = []
  }

  const targetPids = [...new Set([...listeningPids, ...watchPids])]

  if (targetPids.length === 0) {
    console.log(`[server:stop] no backend process found (port=${port})`)
    return
  }

  for (const pid of targetPids) {
    try {
      const reason = listeningPids.includes(pid) ? `listen:${port}` : 'watch'
      stopByPid(pid, reason)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/not found/i.test(message)) {
        console.log(`[server:stop] pid=${pid} already exited`)
      }
      else {
        console.error(`[server:stop] failed to stop pid=${pid}: ${message}`)
      }
    }
  }
}

main()
