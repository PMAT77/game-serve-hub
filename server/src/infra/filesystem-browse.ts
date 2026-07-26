import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { DirectoryItem } from '../../../shared/contracts/system'

const LINUX_ALLOWED_BROWSE_ROOTS = ['/opt', '/srv', '/var/lib']
const FILESYSTEM_SEARCH_MAX_RESULTS = 120
const FILESYSTEM_SEARCH_MAX_DIRECTORIES = 1_000
const FILESYSTEM_SEARCH_MAX_DEPTH = 6
const FILESYSTEM_SEARCH_MAX_DURATION_MS = 100_000

export type { DirectoryItem } from '../../../shared/contracts/system'

function isReadableDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory()
  }
  catch {
    return false
  }
}

function getWindowsDriveRoots(): string[] {
  const roots: string[] = []
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`
    if (isReadableDirectory(drive)) {
      roots.push(drive)
    }
  }
  return roots
}

export function normalizeDirectoryPath(rawPath: string): string {
  return path.resolve(rawPath.trim())
}

function isPathInsideBase(targetPath: string, basePath: string): boolean {
  const relativePath = path.relative(basePath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export function getAllowedBrowseRoots(): string[] {
  if (process.platform === 'win32') {
    return getWindowsDriveRoots()
  }
  return LINUX_ALLOWED_BROWSE_ROOTS
    .map(root => normalizeDirectoryPath(root))
    .filter(root => isReadableDirectory(root))
}

export function isAllowedBrowsePath(targetPath: string, allowedRoots: string[] = getAllowedBrowseRoots()): boolean {
  return allowedRoots.some(root => isPathInsideBase(targetPath, root))
}

export function listRootDirectories(): DirectoryItem[] {
  return getAllowedBrowseRoots().map(root => ({
    name: root,
    path: root,
    type: 'directory',
  }))
}

export function listChildEntries(parentPath: string): DirectoryItem[] {
  const allowedRoots = getAllowedBrowseRoots()
  return fs
    .readdirSync(parentPath, { withFileTypes: true })
    .map((entry) => {
      const fullPath = path.resolve(parentPath, entry.name)
      const type: DirectoryItem['type'] = entry.isDirectory() ? 'directory' : 'file'
      return {
        name: entry.name,
        path: fullPath,
        type,
      }
    })
    .filter(item => isAllowedBrowsePath(item.path, allowedRoots))
    .filter((item) => {
      try {
        fs.accessSync(item.path, fs.constants.R_OK)
        return true
      }
      catch {
        return false
      }
    })
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
}

export function searchFilesystemEntries(keyword: string): DirectoryItem[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return []
  }
  const roots = getAllowedBrowseRoots()
  if (roots.length === 0) {
    return []
  }
  const deadlineAt = Date.now() + FILESYSTEM_SEARCH_MAX_DURATION_MS
  const queue = roots
    .filter(root => isReadableDirectory(root))
    .map(root => ({ directory: root, depth: 0 }))
  const visitedDirectories = new Set<string>()
  const results: DirectoryItem[] = []

  while (queue.length > 0 && results.length < FILESYSTEM_SEARCH_MAX_RESULTS && visitedDirectories.size < FILESYSTEM_SEARCH_MAX_DIRECTORIES) {
    if (Date.now() > deadlineAt) {
      break
    }
    const current = queue.shift()
    if (!current) {
      break
    }
    if (visitedDirectories.has(current.directory)) {
      continue
    }
    visitedDirectories.add(current.directory)

    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (Date.now() > deadlineAt) {
        break
      }
      const fullPath = path.resolve(current.directory, entry.name)
      if (!isAllowedBrowsePath(fullPath, roots) || entry.isSymbolicLink()) {
        continue
      }
      const isDirectory = entry.isDirectory()
      const type: DirectoryItem['type'] = isDirectory ? 'directory' : 'file'
      const name = entry.name
      if (name.toLowerCase().includes(normalizedKeyword)) {
        results.push({
          name,
          path: fullPath,
          type,
        })
        if (results.length >= FILESYSTEM_SEARCH_MAX_RESULTS) {
          break
        }
      }
      if (isDirectory && current.depth < FILESYSTEM_SEARCH_MAX_DEPTH) {
        queue.push({
          directory: fullPath,
          depth: current.depth + 1,
        })
      }
    }
  }

  return results.sort((a, b) => {
    const aSteamcmdExecutable = a.name.toLowerCase() === 'steamcmd.exe'
    const bSteamcmdExecutable = b.name.toLowerCase() === 'steamcmd.exe'
    if (aSteamcmdExecutable !== bSteamcmdExecutable) {
      return aSteamcmdExecutable ? -1 : 1
    }
    if (a.type !== b.type) {
      return a.type === 'file' ? -1 : 1
    }
    return a.path.localeCompare(b.path)
  })
}

export function isReadableDirectoryPath(targetPath: string): boolean {
  return isReadableDirectory(targetPath)
}
