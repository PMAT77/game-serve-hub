import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const version = String(packageJson.version)
const tag = `v${version}`

// v0.2.0 起面板/DST/SteamCMD 合并为同一统一镜像；dst/steamcmd 引用默认与面板一致。
const unifiedImage = `ghcr.io/pmat77/game-server-hub:${tag}`

const requiredReferences = new Map([
  ['scripts/install.linux.sh', [`PANEL_IMAGE_TAG:-${tag}`]],
  ['docker-compose.yml', [unifiedImage]],
  ['docker-compose.dev.yml', [unifiedImage]],
  ['panel.env.example', [unifiedImage]],
  ['server/src/shared/config/index.ts', [unifiedImage]],
  ['README.md', [tag]],
  ['docs/INSTALL.md', [tag]],
  ['CHANGELOG.md', [`## [${version}]`]],
])

const failures = []
for (const [relativePath, expectedValues] of requiredReferences) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
  for (const expected of expectedValues) {
    if (!content.includes(expected)) {
      failures.push(`${relativePath} is missing ${expected}`)
    }
  }
}

// 安装器内置的 compose 资产校验和：镜像源提供的是 git blob 原始字节（LF），
// 改过 compose 却忘了同步 pin 时，发布门禁的「Installer syntax and smoke test」
// 会在 verify_installer_asset_checksum 处失败并阻断整条 Container Pipeline
// （v0.3.9、v0.3.10 都踩过）。这里提前到 release:verify 阶段拦住，并直接给出新值。
const installerComposePins = [
  { asset: 'docker-compose.yml', envKey: 'INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_YML' },
  { asset: 'docker-compose.bind.yml', envKey: 'INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_BIND_YML' },
]
const installerScript = fs.readFileSync(path.join(repoRoot, 'scripts/install.linux.sh'), 'utf8')

for (const { asset, envKey } of installerComposePins) {
  const content = fs.readFileSync(path.join(repoRoot, asset), 'utf8')
  // Windows 检出可能是 CRLF，安装器校验的是 LF（git blob）字节
  const actual = createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
  const pinLine = installerScript.split(/\r?\n/).find(line => line.startsWith(`${envKey}=`))
  const pinned = pinLine ? /([0-9a-f]{64})/.exec(pinLine)?.[1] ?? null : null
  // 安装器允许环境变量覆盖 pin，覆盖时以覆盖值为准
  const effective = process.env[envKey]?.trim() || pinned
  if (!pinned) {
    failures.push(`scripts/install.linux.sh is missing ${envKey}`)
  }
  else if (effective !== actual) {
    failures.push(
      `${asset} 与 ${envKey} 不一致：文件当前为 ${actual}，安装器内置 ${pinned}。`
      + `改过 compose 后必须同步 install.linux.sh 的内置校验和（新值：${actual}）`,
    )
  }
}

const releaseRef = process.env.GITHUB_REF_NAME?.trim()
const releaseRefType = process.env.GITHUB_REF_TYPE?.trim()
if (releaseRefType === 'tag' && releaseRef !== tag) {
  failures.push(`Git tag ${releaseRef || '(empty)'} does not match package version ${tag}`)
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[release-consistency] ${failure}`)
  }
  process.exit(1)
}

console.log(`[release-consistency] ${tag} references are consistent`)
