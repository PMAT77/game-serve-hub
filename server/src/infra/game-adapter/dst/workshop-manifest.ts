import fs from 'node:fs'
import path from 'node:path'
import { DST_WORKSHOP_APP_ID } from './constants'

/**
 * SteamCMD 下载创意工坊内容后，会把每个条目的版本信息写进 appworkshop_<appid>.acf：
 *
 *   "WorkshopItemsInstalled"
 *   {
 *       "2991592240"
 *       {
 *           "size"        "123456"
 *           "timeupdated" "1789572994"
 *           "manifest"    "1234567890123456789"
 *       }
 *   }
 *
 * `timeupdated` 就是「本机这份内容对应工坊哪个版本」——判断「Mod 是否有更新」时
 * 远端 time_updated 要与它比较。文件不存在或格式异常时一律返回空结果，绝不抛错：
 * 老实例、从别处拷贝来的实例都可能没有这份清单，此时版本判定退化为「未知」。
 */

const WORKSHOP_ITEMS_SECTION = 'WorkshopItemsInstalled'

export interface WorkshopInstalledItem {
  /** 工坊版本时间（Unix 秒）；清单里缺失或非法时为 null */
  timeupdated: number | null
  /** Steam 清单 ID；缺失时为 null */
  manifest: string | null
  /** 字节数；缺失时为 null */
  size: number | null
}

/** 工坊清单路径：SteamCMD 的 +force_install_dir 会把清单写在实例根目录下的 steamapps/workshop */
export function resolveWorkshopManifestPath(installPath: string, workshopAppId = DST_WORKSHOP_APP_ID): string {
  return path.join(installPath, 'steamapps', 'workshop', `appworkshop_${workshopAppId}.acf`)
}

/** 取 `"key" { ... }` 形式的分组内容（花括号配对扫描，容忍嵌套） */
function extractSection(content: string, sectionName: string): string | null {
  const keyPattern = new RegExp(`"${sectionName}"\\s*\\{`, 'i')
  const match = keyPattern.exec(content)
  if (!match) {
    return null
  }
  const start = match.index + match[0].length
  let depth = 1
  for (let i = start; i < content.length; i += 1) {
    const ch = content[i]
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return content.slice(start, i)
      }
    }
  }
  // 半写/截断的清单：拿不到闭合括号就不解析，避免把半个条目当成有效版本
  return null
}

function readQuotedField(block: string, field: string): string | null {
  const match = new RegExp(`"${field}"\\s*"([^"]*)"`, 'i').exec(block)
  const value = match?.[1]?.trim()
  return value ? value : null
}

function toPositiveNumber(value: string | null): number | null {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** 解析 WorkshopItemsInstalled 段内的 `<id> { ... }` 条目 */
function parseInstalledItems(section: string): Map<string, WorkshopInstalledItem> {
  const items = new Map<string, WorkshopInstalledItem>()
  const entryPattern = /"(\d+)"\s*\{/g
  let match = entryPattern.exec(section)
  while (match) {
    const workshopId = match[1]!
    const bodyStart = match.index + match[0].length
    let depth = 1
    let end = bodyStart
    for (; end < section.length; end += 1) {
      const ch = section[end]
      if (ch === '{') {
        depth += 1
        continue
      }
      if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          break
        }
      }
    }
    if (depth !== 0) {
      break
    }
    const block = section.slice(bodyStart, end)
    items.set(workshopId, {
      timeupdated: toPositiveNumber(readQuotedField(block, 'timeupdated')),
      manifest: readQuotedField(block, 'manifest'),
      size: toPositiveNumber(readQuotedField(block, 'size')),
    })
    entryPattern.lastIndex = end + 1
    match = entryPattern.exec(section)
  }
  return items
}

/** 读取本机已下载的工坊条目清单；文件缺失/不可读/格式异常时返回空 Map */
export function readWorkshopInstalledItems(
  installPath: string,
  workshopAppId = DST_WORKSHOP_APP_ID,
): Map<string, WorkshopInstalledItem> {
  if (!installPath?.trim()) {
    return new Map()
  }
  try {
    const manifestPath = resolveWorkshopManifestPath(installPath, workshopAppId)
    if (!fs.existsSync(manifestPath)) {
      return new Map()
    }
    const content = fs.readFileSync(manifestPath, 'utf8')
    const section = extractSection(content, WORKSHOP_ITEMS_SECTION)
    if (!section) {
      return new Map()
    }
    return parseInstalledItems(section)
  }
  catch {
    return new Map()
  }
}

/** 单条查询：拿不到返回 null（版本未知），区别于「拿到但没有版本号」 */
export function readWorkshopInstalledItem(
  installPath: string,
  workshopId: string,
  workshopAppId = DST_WORKSHOP_APP_ID,
): WorkshopInstalledItem | null {
  const normalizedId = workshopId.trim()
  if (!normalizedId) {
    return null
  }
  return readWorkshopInstalledItems(installPath, workshopAppId).get(normalizedId) ?? null
}

/** Unix 秒 → ISO；非法值返回 null */
export function unixSecondsToIsoOrNull(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return new Date(value * 1000).toISOString()
}
