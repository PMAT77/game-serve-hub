/**
 * 服务端打包：把 server/src 打成 dist-server/ 下的 ESM bundle。
 *
 * - node_modules 全部 external（--packages=external），运行时复用镜像 deps 层的
 *   node_modules，bundle 只包含应用代码，构建快且零依赖解析风险；
 * - splitting + format=esm 处理 bundle 内的动态 import；
 * - DST leveldata 模板按相对路径 fs 读取，打包后随产物拷贝到 dist-server/templates。
 *
 * 用法：node scripts/build-server.mjs（或 pnpm run build:server）
 */
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const repoRoot = path.resolve(import.meta.dirname, '..')

await build({
  entryPoints: [path.join(repoRoot, 'server/src/main.ts')],
  outdir: path.join(repoRoot, 'dist-server'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
})

fs.cpSync(
  path.join(repoRoot, 'server/src/infra/game-adapter/dst/templates'),
  path.join(repoRoot, 'dist-server/templates'),
  { recursive: true },
)
console.log('[build-server] templates copied to dist-server/templates')
