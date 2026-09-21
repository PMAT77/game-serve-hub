import { z } from 'zod'
import { instanceIdSchema } from './instance'
import { shardIdSchema } from './shard'

/**
 * 地形地图接口的契约。
 *
 * 与「按种子预览」那版的关键区别：**没有参数指纹**。地形反映的是"当前这个世界"，
 * 因此没有"同一个种子算出不同图"的问题，只有"图有多新"的问题——新鲜度由
 * `MapService` 的时间窗口决定，不写在契约里。
 */

/** 地图生成任务的状态机 */
export const mapStatusSchema = z.enum(['idle', 'generating', 'ready', 'failed'])
export type MapStatus = z.infer<typeof mapStatusSchema>

/**
 * 图例项：这张图上真实出现过的地形类别或地标类别。
 *
 * 颜色由服务端给出（与画在 PNG 上的完全同源），前端只负责铺成色块——
 * 两边各写一份色板，迟早会出现"图例写着森林、图上画成沼泽"。
 */
export const mapLegendEntrySchema = z.object({
  /** 稳定标识：`terrain:<地块ID>` 或 `landmark:<分类键>` */
  key: z.string().min(1).max(64),
  kind: z.enum(['terrain', 'landmark']),
  /** 中文名；面板没收录的地块会用游戏报回来的官方名，并带「未收录」字样 */
  label: z.string().min(1).max(32),
  /** `#rrggbb` */
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** 地标的标记形状（与图上画的一致）；地形项为 null */
  shape: z.enum(['circle', 'square', 'diamond']).nullable(),
  count: z.number().int().nonnegative(),
  /** 地形项占全部格子的比例；地标没有这项，为 null */
  ratio: z.number().min(0).max(1).nullable(),
  /** 地形项：这个地块有没有收录配色。为 false 时界面要标出来，提示补色板 */
  known: z.boolean(),
})
export type MapLegendEntryDto = z.infer<typeof mapLegendEntrySchema>

/** 地图查询：首期只支持地上分片 */
export const mapQuerySchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
})
export type MapQuery = z.infer<typeof mapQuerySchema>

export const mapRefreshPayloadSchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
  /** 跳过新鲜度判断，强制重新导出 */
  force: z.boolean().optional(),
})
export type MapRefreshPayload = z.infer<typeof mapRefreshPayloadSchema>

export const mapImageQuerySchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
})
export type MapImageQuery = z.infer<typeof mapImageQuerySchema>

/**
 * 地图状态与元信息。
 *
 * `imagePath` 为 null 表示"现在没有可显示的图"，此时 `message` 必须给出人能看懂的原因
 *（实例没跑、世界还没生成、导出失败等），不允许出现"状态是 ready 但没图"这种自相矛盾。
 */
export const mapDtoSchema = z.object({
  instanceId: instanceIdSchema,
  shard: shardIdSchema,
  status: mapStatusSchema,
  /** 出图时间（ISO）；没有图时为 null */
  exportedAt: z.string().nullable(),
  /** 取图的相对地址（前端拼 API 前缀）；没有图时为 null */
  imagePath: z.string().nullable(),
  /** 地形网格尺寸（格） */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** 每格渲染成的像素数：图片实际像素 = width|height × renderScale */
  renderScale: z.number().int().positive().nullable(),
  /** 世界种子；游戏没记录时为 null */
  seed: z.string().nullable(),
  /** 图上标出的地标总数；没有图时为 null */
  landmarkCount: z.number().int().nonnegative().nullable(),
  /** 图例：图上真实出现过的地形与地标类别 */
  legend: z.array(mapLegendEntrySchema),
  /** 非零地块占比（0–1） */
  filledRatio: z.number().min(0).max(1).nullable(),
  /** 图有多旧（秒）；没有图时为 null。前端据此提示"建议重新生成" */
  ageSeconds: z.number().int().nonnegative().nullable(),
  /** 失败原因、跳过原因或提示；一切正常时为 null */
  message: z.string().nullable(),
})
export type MapDto = z.infer<typeof mapDtoSchema>
