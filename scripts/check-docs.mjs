#!/usr/bin/env node
// 文档一致性校验：相对链接、锚点、版本 tag 与文档索引同步。
// 用法：node scripts/check-docs.mjs（也通过 pnpm run docs:check 调用）
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const docsDir = path.join(repoRoot, 'docs')

const rootDocs = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'MIGRATION.md', 'CHANGELOG.md']
const docsFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.md')).map(f => `docs/${f}`)
const targets = [...rootDocs, ...docsFiles].filter(f => fs.existsSync(path.join(repoRoot, f)))

const failures = []

// GitHub 风格的标题锚点：小写、去掉标点、空格转连字符。
const slugify = heading => heading.trim().replace(/`/g, '').toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/ /g, '-')

const anchorCache = new Map()
function anchorsFor(file) {
  if (!anchorCache.has(file)) {
    const set = new Set()
    for (const line of fs.readFileSync(path.join(repoRoot, file), 'utf8').split(/\r?\n/)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line)
      if (m) set.add(slugify(m[2]))
    }
    anchorCache.set(file, set)
  }
  return anchorCache.get(file)
}

// 1) 相对链接与锚点
const linkRe = /\]\(([^)\s]+)\)/g
const imgRe = /<img[^>]*src="([^"]+)"/g
for (const file of targets) {
  const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split(/\r?\n/)
  const dir = path.posix.dirname(file)
  let inFence = false
  lines.forEach((rawLine, i) => {
    if (/^\s*```/.test(rawLine)) { inFence = !inFence; return }
    if (inFence) return
    // 行内代码中的链接不会被渲染，先剥离再校验
    const line = rawLine.replace(/`[^`]*`/g, '`code`')
    for (const m of [...line.matchAll(linkRe), ...line.matchAll(imgRe)]) {
      const raw = m[1]
      if (/^(https?:|mailto:|#)/.test(raw)) continue
      const [p, ...rest] = raw.split('#')
      const anchor = rest.join('#')
      const rel = p.startsWith('/') ? p.slice(1) : path.posix.normalize(path.posix.join(dir, p))
      if (!fs.existsSync(path.join(repoRoot, rel))) {
        failures.push(`${file}:${i + 1} 链接目标不存在：${raw}`)
        continue
      }
      if (anchor && rel.endsWith('.md') && !anchorsFor(rel).has(anchor)) {
        failures.push(`${file}:${i + 1} 锚点不存在：${raw}`)
      }
    }
  })
}

// 2) 版本 tag 与 package.json 一致（安装 URL、jsDelivr、Release 链接、git clone --branch）
const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const tag = `v${version}`
const tagRe = /(?:raw\.githubusercontent\.com\/[^\s"')]+\/|jsdelivr\.net\/gh\/[^@\s"')]+@|releases\/tag\/|--branch )(v\d+\.\d+\.\d+)/g
for (const file of targets) {
  for (const m of fs.readFileSync(path.join(repoRoot, file), 'utf8').matchAll(tagRe)) {
    if (m[1] !== tag) failures.push(`${file}: 版本 tag ${m[1]} 与 package.json 的 ${tag} 不一致`)
  }
}

// 3) docs 下的文档都应出现在 docs/README.md 索引中
const index = fs.readFileSync(path.join(docsDir, 'README.md'), 'utf8')
for (const f of docsFiles) {
  if (f === 'docs/README.md') continue
  if (!index.includes(`(${path.posix.basename(f)})`)) failures.push(`docs/README.md 未索引：${f}`)
}

// 4) 根 README 必须指向文档主索引
if (!fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8').includes('docs/README.md')) {
  failures.push('README.md 未链接文档主索引 docs/README.md')
}

if (failures.length > 0) {
  console.error('文档校验失败：')
  for (const f of failures) console.error(` - ${f}`)
  process.exit(1)
}
console.log(`文档校验通过：${targets.length} 篇文档，链接、锚点、版本 tag 与索引均一致。`)
