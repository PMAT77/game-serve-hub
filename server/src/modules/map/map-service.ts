import { randomBytes } from 'node:crypto'
import type { MapDto, MapStatus } from '../../../../shared/contracts/map'
import type { ShardId } from '../../../../shared/contracts/shard'
import { landmarkColor, landmarkShape, resolveLandmark } from './landmark-catalog'
import { encodePng } from './png'
import { DEFAULT_TILE_PALETTE, renderTerrain, worldToTile, type MapLandmark } from './terrain-render'
import { buildLegend } from './terrain-legend'
import { computeFilledRatio } from './terrain-stats'
import {
  buildMapExportScript,
  buildMapExportTriggerCommand,
  describeExportFailure,
  parseMapExportFailureLine,
  parseMapExportHeadLine,
  parseMarkLines,
  parseTileNameLine,
  type MapExportApi,
  type MapExportCompletion,
  type ParsedMarkLines,
} from './map-export'
import { decodeTileRuns, parseChunkLines, type ParsedChunkLines } from './terrain-rle'
import {
  clearInstanceMaps,
  hasMapImage,
  readMapArtifacts,
  writeMapArtifacts,
  writeMapImage,
  type MapArtifacts,
} from './map-store'

/**
 * 地图服务的编排。
 *
 * 四个依赖全部注入（控制台、目录解析、日志读取、时间），因此**整条编排都能在本地单测**：
 * 用一个假的游戏回几条日志、写一个假的导出文件，就能把成功、失败、超时、并发、缓存
 * 五种情况全跑一遍。真机上要验的只有"游戏认不认这套 Lua 调用"这一件事。
 *
 * 为什么不复用「按种子试算」那版编排：那版是"起进程、等退出码、读产物目录"；
 * 这版是"下发命令、轮询日志、读文件"——只有产物落盘与新鲜度判断是共用的，
 * 其余没有共同点，硬套只会让两边都难读。
 */

export interface MapServiceDeps {
  /** 面板数据库路径；地图产物与它同级 */
  dbPath: string
  /** 实例是否正在运行；未运行时不可能导出 */
  isShardRunning: (instanceId: string, shard: ShardId) => Promise<boolean>
  /** 下发一行控制台命令 */
  sendCommand: (instanceId: string, shard: ShardId, command: string) => Promise<{ ok: boolean, message?: string }>
  /** 读取某个日志 id 之后的行（返回文本） */
  readLogLines: (instanceId: string, afterId: number) => string[]
  /** 取当前最新日志 id，作为轮询起点 */
  currentLogId: (instanceId: string) => number
  /** 可注入的睡眠，测试里不用真等 */
  sleep?: (ms: number) => Promise<void>
  shardLabels?: Partial<Record<ShardId, string>>
}

export interface MapServiceOptions {
  /** 图多旧算"还新"；窗口内重复请求直接返回缓存，不再打扰游戏 */
  freshWindowMs?: number
  /** 轮询间隔与最大轮询次数（总等待 = 两者相乘） */
  pollIntervalMs?: number
  pollMaxAttempts?: number
  /** 地图数据层调用名；真机校准只改这里 */
  api?: MapExportApi
  /** 每块字符数（影响控制台输出行数） */
  chunkSize?: number
  /** 分块总数上限；超出即失败，不让脚本刷屏 */
  maxChunks?: number
  /** 渲染倍率（每格像素数）；默认 3，见 `terrain-render.ts` */
  renderScale?: number
  /** 地形导出完成后，为等标记段再额外轮询几轮 */
  markWaitAttempts?: number
}

export type MapRefreshResult =
  | { accepted: true, status: MapStatus }
  | { accepted: false, message: string }

const DEFAULT_FRESH_WINDOW_MS = 3 * 60 * 1000
/**
 * 轮询节奏。
 *
 * 数据是分块从控制台日志里收回来的（这台专用服封死了写文件，见 `map-export.ts`），
 * 因此等待时间要比"写文件"那种一次性完成长一些：地形可能分成几十块逐行输出。
 * 250ms × 60 = 15 秒上限——超出就如实报"没传完"，而不是无限等下去。
 */
const DEFAULT_POLL_INTERVAL_MS = 250
const DEFAULT_POLL_MAX_ATTEMPTS = 60

/**
 * 地形传完之后，为等标记段多给的轮询次数。
 *
 * 标记是脚本的最后一段输出，地形最后一块到标记头之间只隔几条 `print`，通常一轮就够；
 * 给到 8 轮（约 2 秒）是为了容忍日志落盘延迟。等不到就按「没有标记」处理——
 * 这是增值信息，不值得让它拖长整次导出。
 */
const DEFAULT_MARK_WAIT_ATTEMPTS = 8

/** 渲染倍率的默认值；与 `terrain-render.ts` 保持一致 */
const DEFAULT_RENDER_SCALE = 3

const DEFAULT_SHARD_LABELS: Record<ShardId, string> = {
  master: '地上',
  caves: '洞穴',
}

export class MapService {
  private readonly deps: MapServiceDeps
  private readonly freshWindowMs: number
  private readonly pollIntervalMs: number
  private readonly pollMaxAttempts: number
  private readonly api: MapExportApi | undefined
  private readonly chunkSize: number | undefined
  private readonly maxChunks: number | undefined
  private readonly renderScale: number
  private readonly markWaitAttempts: number
  /** 正在生成的实例+分片；同一目标不允许并发导出（生成会占游戏主循环） */
  private readonly inFlight = new Set<string>()
  private readonly failures = new Map<string, string>()
  /** 最近一次导出留下的说明（例如"实体表读不到，图上没有地标"），随后续查询一起返回 */
  private readonly notes = new Map<string, string>()

  constructor(deps: MapServiceDeps, options: MapServiceOptions = {}) {
    this.deps = deps
    this.freshWindowMs = options.freshWindowMs ?? DEFAULT_FRESH_WINDOW_MS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.pollMaxAttempts = options.pollMaxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS
    this.api = options.api
    this.chunkSize = options.chunkSize
    this.maxChunks = options.maxChunks
    this.renderScale = options.renderScale ?? DEFAULT_RENDER_SCALE
    this.markWaitAttempts = options.markWaitAttempts ?? DEFAULT_MARK_WAIT_ATTEMPTS
  }

  /** 只读查询：有图就给图，没有就给出原因；不触发任何导出 */
  getState(instanceId: string, shard: ShardId): MapDto {
    const key = this.jobKey(instanceId, shard)
    if (this.inFlight.has(key)) {
      return this.buildDto(instanceId, shard, { status: 'generating', artifacts: null, message: null })
    }
    const artifacts = readMapArtifacts(this.deps.dbPath, instanceId, shard)
    if (artifacts && hasMapImage(this.deps.dbPath, instanceId, shard)) {
      return this.buildDto(instanceId, shard, { status: 'ready', artifacts, message: this.readyMessage(artifacts, key) })
    }
    const failure = this.failures.get(key)
    if (failure) {
      return this.buildDto(instanceId, shard, { status: 'failed', artifacts: null, message: failure })
    }
    return this.buildDto(instanceId, shard, {
      status: 'idle',
      artifacts: null,
      message: '还没有这个分片的地形图，点「生成地图」即可导出当前世界',
    })
  }

  /**
   * 触发一次导出 + 渲染。
   *
   * 同步返回"已受理"，实际工作在后台跑：游戏侧导出是秒级但不可控（要等日志、要读文件），
   * 把 HTTP 请求挂在那儿等，一旦游戏卡住就是一个挂死的请求。前端靠轮询 `getState` 看进度。
   *
   * **实例是否在运行由调用方先查**（路由层用 `isShardRunning` 判），这样"没在跑"能作为
   * 一个普通的业务错误直接返回给用户，而不是先回 200、再在后台悄悄变成 failed——
   * 后者会让前端先显示"生成中"再跳到失败，用户看到的是闪一下的假进度。
   * `runGeneration` 内部仍会再查一次：从点击到真正跑起来之间，实例可能刚好停了。
   */
  refresh(input: {
    instanceId: string
    shard: ShardId
    force?: boolean
  }): MapRefreshResult {
    const { instanceId, shard, force } = input
    const key = this.jobKey(instanceId, shard)
    if (this.inFlight.has(key)) {
      return { accepted: true, status: 'generating' }
    }
    if (!force) {
      const artifacts = readMapArtifacts(this.deps.dbPath, instanceId, shard)
      if (artifacts && hasMapImage(this.deps.dbPath, instanceId, shard)) {
        const ageMs = Date.now() - Date.parse(artifacts.exportedAt)
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < this.freshWindowMs) {
          // 新鲜窗口内不动游戏：这块功能的成本全在"打扰正在跑的世界"上
          return { accepted: true, status: 'ready' }
        }
      }
    }

    /**
     * 不再需要分片目录：地形是分块从控制台日志里收的，不落地文件。
     * 这一整块依赖（`resolveShardDir`）随之可以移除，服务也更容易测。
     */

    this.inFlight.add(key)
    this.failures.delete(key)
    this.notes.delete(key)
    void this.runGeneration({ instanceId, shard, key }).catch((error) => {
      this.failures.set(key, error instanceof Error ? error.message : '地形导出失败')
    }).finally(() => {
      this.inFlight.delete(key)
    })
    return { accepted: true, status: 'generating' }
  }

  /** 清空某实例的地图产物；返回删除的目录数 */
  clear(instanceId: string): number {
    const prefix = `${instanceId}:`
    this.clearKeys(this.failures, prefix)
    this.clearKeys(this.notes, prefix)
    return clearInstanceMaps(this.deps.dbPath, instanceId)
  }

  /** 删掉某个 Map 里属于该实例的键；先收集再删，避免边遍历边改 Map */
  private clearKeys<V>(map: Map<string, V>, prefix: string): void {
    const stale: string[] = []
    for (const key of map.keys()) {
      if (key.startsWith(prefix)) {
        stale.push(key)
      }
    }
    for (const key of stale) {
      map.delete(key)
    }
  }

  /** 测试与优雅退出：等待某实例的任务跑完 */
  async waitForIdle(instanceId: string): Promise<void> {
    const prefix = `${instanceId}:`
    while (this.hasRunningJob(prefix)) {
      await this.sleep(this.pollIntervalMs)
    }
  }

  private hasRunningJob(prefix: string): boolean {
    for (const key of this.inFlight) {
      if (key.startsWith(prefix)) {
        return true
      }
    }
    return false
  }

  private label(shard: ShardId): string {
    return this.deps.shardLabels?.[shard] ?? DEFAULT_SHARD_LABELS[shard]
  }

  private jobKey(instanceId: string, shard: ShardId): string {
    return `${instanceId}:${shard}`
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise(resolve => setTimeout(resolve, ms))
  }

  private freshnessHint(artifacts: MapArtifacts): string | null {
    const ageMs = Date.now() - Date.parse(artifacts.exportedAt)
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return null
    }
    if (ageMs >= this.freshWindowMs) {
      return '这张图已经不是最新的了，建议重新生成'
    }
    return null
  }

  /**
   * ready 状态下的提示语。
   *
   * 把"图旧了"和"这次导出留下的说明"（例如实体表读不到、图上没有地标）拼成一句：
   * 分开判断很容易只显示其中一条，用户就会以为是另一条不存在。
   */
  private readyMessage(artifacts: MapArtifacts, key: string): string | null {
    const parts = [this.freshnessHint(artifacts), this.notes.get(key) ?? null]
      .filter((part): part is string => Boolean(part))
    return parts.length > 0 ? parts.join('；') : null
  }

  /**
   * 把游戏回报的地标点翻译成渲染用的标记。
   *
   * 三件事在这里收口：
   * - **查目录**：不在白名单里的 prefab 直接丢（脚本已经过滤过一遍，这里是兜底）；
   * - **丢图外点**：世界生成会给出图外的参考坐标，画不出来就不该出现在图例里
   *   （否则图例写着"洞穴入口 1 处"、图上却找不到）；
   * - **按格去重**：同一地点可能同时存在多个实体，坐标换算到同一格后本就重叠，
   *   重叠的标记看着是一个点、图例却算两处。
   */
  private toLandmarks(
    points: readonly { prefab: string, x: number, z: number }[],
    width: number,
    height: number,
  ): MapLandmark[] {
    const unique = new Map<string, MapLandmark>()
    for (const point of points) {
      const spec = resolveLandmark(point.prefab)
      if (!spec) {
        continue
      }
      const { tileX, tileZ } = worldToTile(point.x, point.z, width, height)
      if (tileX < 0 || tileZ < 0 || tileX >= width || tileZ >= height) {
        continue
      }
      const id = `${spec.key}:${tileX}:${tileZ}`
      if (unique.has(id)) {
        continue
      }
      unique.set(id, {
        key: spec.key,
        x: point.x,
        z: point.z,
        color: landmarkColor(spec.key),
        shape: landmarkShape(spec.key),
      })
    }
    return [...unique.values()]
  }

  /**
   * 一次完整导出。
   *
   * 顺序刻意如此：确认实例在跑 → 下发命令 → 按序号收集分块 → 解码 → 渲染 → 落盘。
   * 任何一步失败都在此收口并翻译成用户能懂的一句话，**不留半成品**（不写元信息就不会有
   * "状态 ready 但图是旧的"这种错配）。
   *
   * 数据是从控制台日志里收的，不是读文件——这台专用服封死了所有写文件通道（见
   * `map-export.ts` 的说明）。因此轮询必须等到**头行 + 全部分块**齐了才收工，
   * 缺块就如实报失败，绝不拼一张错位的地图。
   *
   * 地标是增值层：它的分块没收到只让图上少一层标注，不影响这次导出算不算成功。
   */
  private async runGeneration(input: {
    instanceId: string
    shard: ShardId
    key: string
  }): Promise<void> {
    const { instanceId, shard, key } = input
    const running = await this.deps.isShardRunning(instanceId, shard)
    if (!running) {
      this.failures.set(key, `${this.label(shard)}分片未运行，无法读取世界地形`)
      return
    }

    const script = buildMapExportScript({
      shard,
      ...(this.api ? { api: this.api } : {}),
      ...(this.chunkSize ? { chunkSize: this.chunkSize } : {}),
      ...(this.maxChunks ? { maxChunks: this.maxChunks } : {}),
    })
    const token = randomBytes(4).toString('hex')
    const command = buildMapExportTriggerCommand(script, token)

    const afterId = this.deps.currentLogId(instanceId)
    const sent = await this.deps.sendCommand(instanceId, shard, command)
    if (!sent.ok) {
      this.failures.set(key, sent.message ?? '地形导出命令下发失败')
      return
    }

    let head: Extract<MapExportCompletion, { kind: 'ok' }> | null = null
    let chunks: ParsedChunkLines | null = null
    let marks: ParsedMarkLines = { status: 'absent', points: [], complete: true, missing: [] }
    let marksWaited = 0
    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt += 1) {
      await this.sleep(this.pollIntervalMs)
      const lines = this.deps.readLogLines(instanceId, afterId)
      if (!head) {
        for (const line of lines) {
          const failure = parseMapExportFailureLine(line)
          if (failure) {
            this.failures.set(key, describeExportFailure(failure))
            return
          }
          const parsedHead = parseMapExportHeadLine(line)
          if (parsedHead) {
            if (parsedHead.kind === 'failed') {
              this.failures.set(key, parsedHead.reason)
              return
            }
            head = parsedHead
            break
          }
        }
      }
      if (!head) {
        continue
      }
      chunks = parseChunkLines(lines, token)
      if (!chunks.complete) {
        continue
      }
      /**
       * 地形已经收齐，但脚本还要接着打标记段。这里再给几轮：等不到就按"没有标记"处理，
       * 绝不因为增值信息没到而把整次导出拖到超时。
       */
      const parsedMarks = parseMarkLines(lines, token)
      const marksReady = parsedMarks.status !== 'absent'
        && (parsedMarks.status !== 'ok' || parsedMarks.complete)
      if (marksReady) {
        marks = parsedMarks
        break
      }
      marksWaited += 1
      if (marksWaited >= this.markWaitAttempts) {
        marks = parsedMarks
        break
      }
    }

    if (!head) {
      this.failures.set(key, '导出超时：游戏没有在预期时间内回报结果（世界可能仍在生成）')
      return
    }
    if (!chunks?.complete) {
      const missing = chunks?.missing.length ?? 0
      const received = chunks?.received ?? 0
      const total = chunks?.expected ?? head.totalParts
      this.failures.set(
        key,
        missing > 0
          ? `地形数据不完整：收到 ${received}/${total} 块，缺 ${missing} 块（控制台日志可能被刷屏冲掉，请重试）`
          : '导出超时：地形数据没有传完（世界可能仍在加载）',
      )
      return
    }

    let tiles: Uint16Array
    try {
      tiles = decodeTileRuns(chunks.payload, head.width * head.height)
    }
    catch (error) {
      this.failures.set(key, error instanceof Error ? error.message : '地形数据解码失败')
      return
    }

    const landmarks = this.toLandmarks(marks.points, head.width, head.height)
    // 游戏自己报的地块名：面板不认识的号靠它才有名字（见 `parseTileNameLine`）
    const gameNames = parseTileNameLine(this.deps.readLogLines(instanceId, afterId))
    const image = encodePng(renderTerrain({
      width: head.width,
      height: head.height,
      tiles,
      landmarks,
      palette: DEFAULT_TILE_PALETTE,
      scale: this.renderScale,
    }), 6)
    writeMapImage(this.deps.dbPath, instanceId, shard, image)
    const legend = buildLegend({ tiles, palette: DEFAULT_TILE_PALETTE, landmarks, gameNames })
    const artifacts: MapArtifacts = {
      instanceId,
      shard,
      exportedAt: new Date().toISOString(),
      width: head.width,
      height: head.height,
      renderScale: this.renderScale,
      seed: head.seed,
      landmarkCount: landmarks.length,
      legend,
      filledRatio: computeFilledRatio(tiles),
    }
    writeMapArtifacts(this.deps.dbPath, artifacts)

    /**
     * 只在"确实有需要说明的事"时留一句话。三种情况可以叠加，所以先收集再拼：
     * - 实体表读不到（脚本报了 no-ents），或标记段没传完；
     * - 出现了面板还没收录的地块——图例里已标成「未收录」，这里再说一句是为了让人知道该补配色。
     * 世界本来就没有这些地标、地块也都收录了时一个字都不说，那才是最正常的情况。
     */
    const notes: string[] = []
    if (marks.status === 'no-ents') {
      notes.push('这次导出没有读到游戏里的实体表，图上不含地标标注')
    }
    else if (marks.status === 'ok' && !marks.complete) {
      notes.push('地标数据没有传完，图上可能缺少部分地标')
    }
    const unknownTiles = legend.filter(entry => entry.kind === 'terrain' && !entry.known)
    if (unknownTiles.length > 0) {
      const sample = unknownTiles.slice(0, 3).map(entry => entry.label).join('、')
      notes.push(`有 ${unknownTiles.length} 种地块还没有收录配色（${sample}），图例里已标为「未收录」`)
    }
    if (notes.length > 0) {
      this.notes.set(key, notes.join('；'))
    }
    else {
      this.notes.delete(key)
    }
  }

  private buildDto(
    instanceId: string,
    shard: ShardId,
    input: {
      status: MapStatus
      artifacts: MapArtifacts | null
      message: string | null
    },
  ): MapDto {
    const { artifacts, status, message } = input
    const ageSeconds = artifacts
      ? Math.max(0, Math.round((Date.now() - Date.parse(artifacts.exportedAt)) / 1000))
      : null
    return {
      instanceId,
      shard,
      status,
      exportedAt: artifacts?.exportedAt ?? null,
      imagePath: artifacts
        ? `app/instance/map/image?instanceId=${encodeURIComponent(instanceId)}&shard=${shard}`
        : null,
      width: artifacts?.width ?? null,
      height: artifacts?.height ?? null,
      renderScale: artifacts?.renderScale ?? null,
      seed: artifacts?.seed ?? null,
      landmarkCount: artifacts ? artifacts.landmarkCount : null,
      /**
       * 图例随产物一起落盘、随状态一起返回：它是"这张图里有什么"的完整答案，
       * 前端不需要（也不该）再维护一份色板去猜。
       */
      legend: artifacts?.legend ?? [],
      filledRatio: artifacts?.filledRatio ?? null,
      ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : null,
      message,
    }
  }
}
