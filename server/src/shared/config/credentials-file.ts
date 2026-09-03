import fs from 'node:fs'
import path from 'node:path'

/** 初始管理员凭据文件名（与数据库同目录，0600 权限） */
export const ADMIN_CREDENTIALS_FILENAME = 'admin-credentials.txt'

export function resolveAdminCredentialsFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), ADMIN_CREDENTIALS_FILENAME)
}

/**
 * 生产环境自动生成管理员密码时，把凭据写入 0600 权限文件。
 * 密码不得进入应用日志（journald/日志采集管道不可信）。
 */
export function writeAdminCredentialsFile(dbPath: string, username: string, password: string): string {
  const filePath = resolveAdminCredentialsFilePath(dbPath)
  fs.writeFileSync(filePath, [
    '# Game Server Hub 初始管理员凭据',
    '# 首次登录修改密码后本文件即失效，可手动删除。',
    `ADMIN_USERNAME=${username}`,
    `ADMIN_PASSWORD=${password}`,
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })
  return filePath
}

/** 首次强制改密完成后删除初始凭据文件（幂等，失败不影响主流程） */
export function deleteAdminCredentialsFile(dbPath: string): void {
  try {
    fs.rmSync(resolveAdminCredentialsFilePath(dbPath), { force: true })
  }
  catch {
    // 文件仅含已被替换的初始密码，删除失败无需阻断改密流程。
  }
}
