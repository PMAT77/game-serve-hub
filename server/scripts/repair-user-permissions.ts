/**
 * 权限初始化/修复脚本：
 * - 默认修复管理员账号（superadmin + ADMIN_USERNAME）的 system 权限
 * - 可通过参数为指定账号批量补权限
 *
 * 用法示例：
 * 1) 默认修复管理员 system 权限
 *    pnpm exec tsx server/scripts/repair-user-permissions.ts
 *
 * 2) 给指定账号补 system 管理权限
 *    pnpm exec tsx server/scripts/repair-user-permissions.ts --account=ops
 *
 * 3) 给多个账号补权限（含节点管理）
 *    pnpm exec tsx server/scripts/repair-user-permissions.ts --account=ops,test --include-node-manage
 *
 * 4) 自定义权限集合
 *    pnpm exec tsx server/scripts/repair-user-permissions.ts --account=ops --permission=system:read --permission=system:manage
 *
 * 5) 仅预览，不落库
 *    pnpm exec tsx server/scripts/repair-user-permissions.ts --dry-run
 */
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { loadServerConfig } from '../src/shared/config/index'
import {
  NODE_INSTANCE_MANAGE_PERMISSION,
  SYSTEM_MANAGE_PERMISSION,
  SYSTEM_READ_PERMISSION,
} from '../src/shared/menu-routes'

interface ScriptOptions {
  accounts: string[]
  permissions: string[]
  dryRun: boolean
}

interface UserRow {
  id: string
  account: string
}

const DEFAULT_SYSTEM_PERMISSIONS = [
  SYSTEM_READ_PERMISSION,
  SYSTEM_MANAGE_PERMISSION,
]

function printHelpAndExit(code = 0): never {
  console.log(`
权限初始化/修复脚本

参数：
  --account=<name[,name2]>     指定目标账号（可重复）
  --permission=<perm[,perm2]>  指定要授予的权限（可重复）
  --include-node-manage        额外授予 pages.node.instance:manage
  --dry-run                    仅预览，不落库
  --help                       查看帮助
`)
  process.exit(code)
}

function splitCsvArg(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseOptions(argv: string[]): ScriptOptions {
  const accountSet = new Set<string>()
  const permissionSet = new Set<string>(DEFAULT_SYSTEM_PERMISSIONS)
  let hasCustomPermissionArg = false
  let includeNodeManage = false
  let dryRun = false

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit(0)
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--include-node-manage') {
      includeNodeManage = true
      continue
    }
    if (arg.startsWith('--account=')) {
      const raw = arg.slice('--account='.length).trim()
      for (const account of splitCsvArg(raw)) {
        accountSet.add(account)
      }
      continue
    }
    if (arg.startsWith('--permission=')) {
      const raw = arg.slice('--permission='.length).trim()
      if (!hasCustomPermissionArg) {
        permissionSet.clear()
        hasCustomPermissionArg = true
      }
      for (const permission of splitCsvArg(raw)) {
        permissionSet.add(permission)
      }
      continue
    }
    console.error(`未知参数：${arg}`)
    printHelpAndExit(1)
  }

  if (includeNodeManage) {
    permissionSet.add(NODE_INSTANCE_MANAGE_PERMISSION)
  }

  const config = loadServerConfig()
  accountSet.add('superadmin')
  if (config.adminUsername.trim()) {
    accountSet.add(config.adminUsername.trim())
  }

  const accounts = Array.from(accountSet)
  const permissions = Array.from(permissionSet)
  if (accounts.length === 0) {
    throw new Error('未找到可修复账号，请通过 --account 指定')
  }
  if (permissions.length === 0) {
    throw new Error('权限集合为空，请通过 --permission 指定至少一个权限')
  }

  return {
    accounts,
    permissions,
    dryRun,
  }
}

function resolveUsers(db: DatabaseSync, accounts: string[]): {
  foundUsers: UserRow[]
  missingAccounts: string[]
} {
  const foundUsers: UserRow[] = []
  const missingAccounts: string[] = []
  const queryUser = db.prepare('SELECT id, account FROM users WHERE account = ? LIMIT 1')

  for (const account of accounts) {
    const row = queryUser.get(account) as UserRow | undefined
    if (!row) {
      missingAccounts.push(account)
      continue
    }
    foundUsers.push(row)
  }
  return { foundUsers, missingAccounts }
}

function ensurePermissions(
  db: DatabaseSync,
  users: UserRow[],
  permissions: string[],
  dryRun: boolean,
) {
  const now = new Date().toISOString()
  const insertPermission = db.prepare(`
    INSERT INTO user_permissions (user_id, permission, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, permission) DO NOTHING
  `)
  const hasPermission = db.prepare(`
    SELECT 1 AS ok
    FROM user_permissions
    WHERE user_id = ? AND permission = ?
    LIMIT 1
  `)

  let insertedCount = 0
  const alreadyPairs: Array<{ account: string, permission: string }> = []
  const insertedPairs: Array<{ account: string, permission: string }> = []

  for (const user of users) {
    for (const permission of permissions) {
      const exists = hasPermission.get(user.id, permission) as { ok: number } | undefined
      if (exists) {
        alreadyPairs.push({ account: user.account, permission })
        continue
      }
      if (!dryRun) {
        insertPermission.run(user.id, permission, now)
      }
      insertedCount += 1
      insertedPairs.push({ account: user.account, permission })
    }
  }

  return {
    insertedCount,
    alreadyPairs,
    insertedPairs,
  }
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  const config = loadServerConfig()
  const db = new DatabaseSync(config.dbPath)

  console.log(`[权限修复] DB: ${config.dbPath}`)
  console.log(`[权限修复] 目标账号: ${options.accounts.join(', ')}`)
  console.log(`[权限修复] 权限集合: ${options.permissions.join(', ')}`)
  console.log(`[权限修复] 模式: ${options.dryRun ? 'dry-run' : 'apply'}`)

  const { foundUsers, missingAccounts } = resolveUsers(db, options.accounts)
  if (missingAccounts.length > 0) {
    console.warn(`[权限修复] 以下账号不存在，已跳过: ${missingAccounts.join(', ')}`)
  }
  if (foundUsers.length === 0) {
    console.warn('[权限修复] 未找到任何有效账号，脚本结束。')
    return
  }

  if (!options.dryRun) {
    db.exec('BEGIN')
  }
  try {
    const result = ensurePermissions(db, foundUsers, options.permissions, options.dryRun)
    if (!options.dryRun) {
      db.exec('COMMIT')
    }
    console.log(`[权限修复] 新增权限记录: ${result.insertedCount}`)
    if (result.insertedPairs.length > 0) {
      console.log('[权限修复] 新增明细:')
      for (const item of result.insertedPairs) {
        console.log(`  + ${item.account} -> ${item.permission}`)
      }
    }
    if (result.alreadyPairs.length > 0) {
      console.log(`[权限修复] 已存在无需变更: ${result.alreadyPairs.length}`)
    }
  }
  catch (error) {
    if (!options.dryRun) {
      db.exec('ROLLBACK')
    }
    throw error
  }
}

main()
