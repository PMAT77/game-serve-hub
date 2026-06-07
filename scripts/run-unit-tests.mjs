process.env.GSH_UNIT_TEST = '1'

import { spawnSync } from 'node:child_process'

const args = [
  'exec',
  'tsx',
  '--test',
  '--test-force-exit',
  '--test-concurrency=1',
  'server/src/**/*.test.ts',
  'scripts/**/*.test.ts',
  'src/views/node/instance/instanceStartGuide.test.ts',
]

const result = spawnSync('pnpm', args, {
  stdio: 'inherit',
  env: process.env,
  shell: true,
})

process.exit(result.status ?? 1)
