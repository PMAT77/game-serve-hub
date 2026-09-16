import type { FastifyReply } from 'fastify'
import fs from 'node:fs'

export interface FileDownloadOptions {
  filePath: string
  contentType: string
  fileName: string
}

/**
 * 下载路由的统一出口：设置下载响应头并把文件流交给 Fastify。
 *
 * 调用方必须把返回值 `return` 出去（`return sendFileDownload(reply, ...)`）。
 *
 * 为什么不能只写 `reply.send(stream)`：流式发送要到下一个 tick 才置位 `reply.sent`，
 * 而 async handler 不 return 时隐式返回 `undefined`，Fastify 会认为 handler 什么都没发，
 * 随即用空 payload 结束响应 —— 表现为 HTTP 200 + `Content-Length: 0`，
 * 用户下载到一个 0 字节文件。同一个 `reply.send()` 在同步 handler 与
 * `reply.send(object)` 的错误分支里都正常，只有「async + 文件流 + 不返回」会中招，
 * 所以这条约束收在一个函数里，比在三处路由各写一遍更不容易漏。
 *
 * 这里继续用流而不是 `readFileSync`：备份包可能很大，不该整个读进内存。
 */
export function sendFileDownload(reply: FastifyReply, options: FileDownloadOptions): FastifyReply {
  reply.header('Content-Type', options.contentType)
  reply.header('Content-Disposition', `attachment; filename="${options.fileName}"`)
  return reply.send(fs.createReadStream(options.filePath))
}
