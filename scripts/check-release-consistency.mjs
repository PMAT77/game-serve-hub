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
