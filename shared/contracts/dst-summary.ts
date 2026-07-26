import { z } from 'zod'
import { clusterNetworkModeSchema } from './cluster'
import { instanceItemSchema } from './instance'
import { shardContainerStatusSchema } from './shard'

const nullableSummaryErrorSchema = z.string().nullable()

export const dstRoomSummarySchema = z.object({
  clusterName: z.string().nullable(),
  networkMode: clusterNetworkModeSchema.nullable(),
  shardEnabled: z.boolean().nullable(),
  onlinePlayerCount: z.number().int().nonnegative().nullable(),
  maxPlayers: z.number().int().min(1).max(64).nullable(),
  error: nullableSummaryErrorSchema,
})
export type DstRoomSummaryDto = z.infer<typeof dstRoomSummarySchema>

export const dstWorldShardSummarySchema = z.object({
  configured: z.boolean(),
  containerStatus: shardContainerStatusSchema,
})
export type DstWorldShardSummaryDto = z.infer<typeof dstWorldShardSummarySchema>

export const dstWorldSummarySchema = z.object({
  clusterShardEnabled: z.boolean().nullable(),
  master: dstWorldShardSummarySchema.nullable(),
  caves: dstWorldShardSummarySchema.nullable(),
  error: nullableSummaryErrorSchema,
})
export type DstWorldSummaryDto = z.infer<typeof dstWorldSummarySchema>

export const dstInstanceSummarySchema = z.object({
  instance: instanceItemSchema,
  room: dstRoomSummarySchema,
  world: dstWorldSummarySchema,
})
export type DstInstanceSummaryDto = z.infer<typeof dstInstanceSummarySchema>

export const dstInstanceSummariesSchema = z.object({
  items: z.array(dstInstanceSummarySchema),
  collectedAt: z.string(),
})
export type DstInstanceSummariesDto = z.infer<typeof dstInstanceSummariesSchema>
