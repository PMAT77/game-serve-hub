import process from 'node:process'
import { ensureServerRuntimeDirs, loadServerConfig } from '../src/shared/config'

function main() {
  const config = loadServerConfig()
  ensureServerRuntimeDirs(config)
  console.log(`[server:prepare] mode=${config.mode}`)
  console.log(`[server:prepare] env=${config.envFile}`)
  console.log(`[server:prepare] db=${config.dbPath}`)
  console.log(`[server:prepare] logs=${config.logDir}`)
}

main()

process.exitCode = 0
