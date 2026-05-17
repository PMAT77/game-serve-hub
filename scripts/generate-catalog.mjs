/**
 * Validate and optionally trim pnpm catalog entries for this standalone workspace.
 *
 * Usage:
 *   node scripts/generate-catalog.mjs              # validate catalog: deps (default)
 *   node scripts/generate-catalog.mjs --write      # trim catalog to referenced keys
 *   node scripts/generate-catalog.mjs --write --import ../fantastic-admin/pnpm-workspace.yaml
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceFile = path.join(root, 'pnpm-workspace.yaml')

const EXTRA_CATALOG_KEYS = new Set([
  'unocss',
  'unocss-preset-animations',
  '@unocss/core',
  'unbuild',
  '@iconify/json',
])

function parseArgs(argv) {
  const args = { write: false, importPath: '' }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') {
      args.write = true
    }
    else if (arg === '--import') {
      args.importPath = argv[i + 1] ?? ''
      i += 1
    }
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
    else {
      console.error(`Unknown argument: ${arg}`)
      printHelp()
      process.exit(1)
    }
  }
  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-catalog.mjs [--write] [--import <pnpm-workspace.yaml>]

  --write   Rewrite the catalog section using versions from this repo (and optional --import).
  --import  External workspace file used only to resolve versions for newly referenced catalog keys.
`)
}

function parseCatalogSection(content) {
  const catalog = new Map()
  let inCatalog = false

  for (const line of content.split('\n')) {
    if (line.startsWith('catalogs:'))
      break
    if (line === 'catalog:') {
      inCatalog = true
      continue
    }
    if (!inCatalog)
      continue

    const m = line.match(/^  '([^']+)': (.+)$/) || line.match(/^  ([^:]+): (.+)$/)
    if (m)
      catalog.set(m[1], m[2].trim())
  }

  return catalog
}

function collectCatalogKeys() {
  const keys = new Set(EXTRA_CATALOG_KEYS)
  const packagesDir = path.join(root, 'packages')

  const pkgFiles = [path.join(root, 'package.json')]
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pkgFiles.push(path.join(packagesDir, entry.name, 'package.json'))
      }
    }
  }

  function walkDeps(obj) {
    if (!obj || typeof obj !== 'object')
      return
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value === 'catalog:')
        keys.add(key)
    }
  }

  for (const file of pkgFiles) {
    if (!fs.existsSync(file))
      continue
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      walkDeps(pkg[section])
    }
  }

  return keys
}

function resolveCatalogVersions(requiredKeys, localCatalog, importCatalog) {
  const picked = {}
  const missing = []

  for (const key of [...requiredKeys].sort()) {
    if (localCatalog.has(key)) {
      picked[key] = localCatalog.get(key)
    }
    else if (importCatalog?.has(key)) {
      picked[key] = importCatalog.get(key)
    }
    else {
      missing.push(key)
    }
  }

  return { picked, missing }
}

function formatCatalogLines(catalogEntries) {
  return Object.entries(catalogEntries)
    .map(([key, version]) => {
      const label = key.includes('/') || key.startsWith('@') ? `'${key}'` : key
      return `  ${label}: ${version}`
    })
    .join('\n')
}

function rewriteWorkspaceCatalog(content, catalogEntries) {
  const lines = content.split('\n')
  const catalogStart = lines.findIndex(line => line === 'catalog:')
  const catalogsStart = lines.findIndex(line => line.startsWith('catalogs:'))

  if (catalogStart === -1 || catalogsStart === -1 || catalogsStart <= catalogStart) {
    throw new Error('pnpm-workspace.yaml must contain catalog: and catalogs: sections')
  }

  const next = [
    ...lines.slice(0, catalogStart + 1),
    formatCatalogLines(catalogEntries),
    ...lines.slice(catalogsStart),
  ]

  const normalized = `${next.join('\n').replace(/\n*$/, '')}\n`
  return normalized
}

function main() {
  const args = parseArgs(process.argv)

  if (!fs.existsSync(workspaceFile)) {
    console.error(`Missing workspace file: ${workspaceFile}`)
    process.exit(1)
  }

  const workspaceContent = fs.readFileSync(workspaceFile, 'utf8')
  const localCatalog = parseCatalogSection(workspaceContent)
  const requiredKeys = collectCatalogKeys()

  let importCatalog
  if (args.importPath) {
    const importFile = path.resolve(root, args.importPath)
    if (!fs.existsSync(importFile)) {
      console.error(`Import file not found: ${importFile}`)
      process.exit(1)
    }
    importCatalog = parseCatalogSection(fs.readFileSync(importFile, 'utf8'))
  }

  const { picked, missing } = resolveCatalogVersions(requiredKeys, localCatalog, importCatalog)

  if (missing.length) {
    console.error('Missing catalog keys in workspace catalog:', missing)
    if (!args.importPath) {
      console.error('Add versions to pnpm-workspace.yaml, or rerun with --import <external-pnpm-workspace.yaml>.')
    }
    process.exit(1)
  }

  if (args.write) {
    const nextContent = rewriteWorkspaceCatalog(workspaceContent, picked)
    fs.writeFileSync(workspaceFile, nextContent)
    console.log(`Updated ${workspaceFile} with ${Object.keys(picked).length} catalog entries`)
  }
  else {
    console.log(`Catalog OK: ${Object.keys(picked).length} referenced keys are defined in ${workspaceFile}`)
  }
}

main()
