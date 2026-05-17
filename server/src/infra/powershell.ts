import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const EXEC_FILE_MAX_BUFFER = 10 * 1024 * 1024
const POWERSHELL_PROBE_TIMEOUT_MS = 1_200

const execFileAsync = promisify(execFile)

export async function execPowerShellAsync(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8',
        timeout: POWERSHELL_PROBE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: EXEC_FILE_MAX_BUFFER,
      },
    )
    const text = typeof stdout === 'string' ? stdout.trim() : ''
    return text || null
  }
  catch {
    return null
  }
}
