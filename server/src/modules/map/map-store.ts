import fs from 'node:fs'
import path from 'node:path'
import { mapLegendEntrySchema, type MapLegendEntryDto } from '../../../../shared/contracts/map'
import type { ShardId } from '../../../../shared/contracts/shard'

/**
 * 地图产物的落盘布局。
 *
 * 位置在**面板数据目录**下、与安装日志同级，**绝不写进实例目录**：实例目录里多一个
 * 看起来像存档的目录，会干扰面板对"世界是否已生成"的判断，这是这块功能最容易踩的坑。
 *
 * ```text
 * <数据目录>/maps/<实例 ID>/<分片>/
 *   map.png        渲染后的地形图
 *   result.json    元信息（尺寸、种子、导出时间、图例、地标数）
 * ```
 *
 * 与"按种子试算"那版不同，这里用**分片名**做目录键而不是参数指纹：地形反映的是
 * "当前这个世界"，新鲜度是时间问题（见 `MapService` 的新鲜窗口），不是参数问题。
 */

/** 地图产物元信息；与前端 DTO 一一对应 */
export interface MapArtifacts {
  instanceId: string
  shard: ShardId
  /** 导出完成时间（ISO） */
  exportedAt: string
  /** 地形网格尺寸（格） */
  width: number
  height: number
  /** 每格渲染成的像素数 */
  renderScale: number
  /** 世界种子；游戏没记录时为 null */
  seed: string | null
  /** 图上标出的地标总数 */
  landmarkCount: number
  /** 图例：图上真实出现过的地形与地标类别 */
  legend: MapLegendEntryDto[]
  /** 非零地块的占比（0–1），用于界面上判断"这张图是不是基本空的" */
  filledRatio: number
}

/**
 * 实例 ID 会成为目录名，先剔除路径分隔符等字符。
 *
 * 与 `console-log-file.ts` 的做法一致：宁可把异常 ID 规整成一个安全名字，
 * 也不要让 `../` 之类的东西决定写盘位置。
 */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_')
}

export function resolveMapRoot(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'maps')
}

export function resolveInstanceMapDir(dbPath: string, instanceId: string): string {
  return path.join(resolveMapRoot(dbPath), safeSegment(instanceId))
}

/** 分片目录：分片名由契约约束为 master / caves，不可能是路径片段 */
export function resolveShardMapDir(dbPath: string, instanceId: string, shard: ShardId): string {
  return path.join(resolveInstanceMapDir(dbPath, instanceId), shard)
}

export function resolveMapImagePath(dbPath: string, instanceId: string, shard: ShardId): string {
  return path.join(resolveShardMapDir(dbPath, instanceId, shard), 'map.png')
}

export function resolveMapResultPath(dbPath: string, instanceId: string, shard: ShardId): string {
  return path.join(resolveShardMapDir(dbPath, instanceId, shard), 'result.json')
}

export function ensureShardMapDir(dbPath: string, instanceId: string, shard: ShardId): string {
  const dir = resolveShardMapDir(dbPath, instanceId, shard)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 写图片。
 *
 * 与元信息分开写、**元信息最后写**：读的一侧只要看到 `result.json`，就说明这次渲染已经完成，
 * 不会出现"图是新的、元信息还是旧的"这种错配。
 */
export function writeMapImage(dbPath: string, instanceId: string, shard: ShardId, bytes: Buffer): void {
  ensureShardMapDir(dbPath, instanceId, shard)
  const target = resolveMapImagePath(dbPath, instanceId, shard)
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, bytes)
  fs.renameSync(temporary, target)
}

export function writeMapArtifacts(dbPath: string, artifacts: MapArtifacts): void {
  ensureShardMapDir(dbPath, artifacts.instanceId, artifacts.shard)
  const target = resolveMapResultPath(dbPath, artifacts.instanceId, artifacts.shard)
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(artifacts, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, target)
}

/**
 * 图例归一化。
 *
 * 用契约 schema 逐项校验而不是"是数组就信"：`result.json` 是我们自己写的，但它也可能
 * 被外部改过或被旧版本写过。混进一个形状不对的项，前端渲染图例时就会炸在用户眼前，
 * 而在读盘这里丢掉它，代价只是少一行图例。
 */
function normalizeLegend(value: unknown): MapLegendEntryDto[] {
  const parsed = mapLegendEntrySchema.array().safeParse(value)
  return parsed.success ? parsed.data : []
}

/**
 * 读元信息；目录不存在、JSON 损坏或关键字段缺失时返回 null。
 *
 * 坏数据按"没有地图"处理，让用户重新生成一次，而不是抛错——缓存是我们自己写的，
 * 读到坏数据说明它被外部动过，报错给用户没有意义。
 */
export function readMapArtifacts(dbPath: string, instanceId: string, shard: ShardId): MapArtifacts | null {
  let raw: string
  try {
    raw = fs.readFileSync(resolveMapResultPath(dbPath, instanceId, shard), 'utf8')
  }
  catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as MapArtifacts
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (typeof parsed.exportedAt !== 'string' || !Number.isInteger(parsed.width) || !Number.isInteger(parsed.height)) {
      return null
    }
    if (parsed.width <= 0 || parsed.height <= 0) {
      return null
    }
    return {
      ...parsed,
      seed: typeof parsed.seed === 'string' ? parsed.seed : null,
      landmarkCount: Number.isInteger(parsed.landmarkCount) ? parsed.landmarkCount : 0,
      // 更早的产物是"一格一像素"渲染的，缺这个字段时按 1 解释才与那张图相符
      renderScale: Number.isInteger(parsed.renderScale) && parsed.renderScale > 0 ? parsed.renderScale : 1,
      legend: normalizeLegend(parsed.legend),
      filledRatio: Number.isFinite(parsed.filledRatio) ? parsed.filledRatio : 0,
    }
  }
  catch {
    return null
  }
}

export function hasMapImage(dbPath: string, instanceId: string, shard: ShardId): boolean {
  try {
    return fs.statSync(resolveMapImagePath(dbPath, instanceId, shard)).size > 0
  }
  catch {
    return false
  }
}

/** 删除某实例的全部地图产物（两个分片一起清）；返回删除的目录数 */
export function clearInstanceMaps(dbPath: string, instanceId: string): number {
  const dir = resolveInstanceMapDir(dbPath, instanceId)
  if (!fs.existsSync(dir)) {
    return 0
  }
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const entry = path.join(dir, name)
    try {
      if (fs.statSync(entry).isDirectory()) {
        fs.rmSync(entry, { recursive: true, force: true })
        removed += 1
      }
    }
    catch {
      // 单个目录删不掉不影响其余：清理是尽力而为，不是事务
    }
  }
  return removed
}
