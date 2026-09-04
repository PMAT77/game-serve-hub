process.env.GSH_UNIT_TEST = '1'

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = [
  path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  '--test',
  '--test-force-exit',
  '--test-concurrency=1',
  'server/src/**/*.test.ts',
]

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
  cwd: repoRoot,
})

process.exit(result.status ?? 1)
