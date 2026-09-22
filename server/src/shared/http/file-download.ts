import type { FastifyReply } from 'fastify'
import fs from 'node:fs'

export interface FileDownloadOptions {
  filePath: string
  contentType: string
  fileName: string
}

/** 纯 ASCII 且不含引号与反斜杠的文件名才能直接放进 filename= */
const ASCII_FILE_NAME_PATTERN = /^[\x20-\x7e]+$/

/**
 * 组装 Content-Disposition。
 *
 * 为什么不能直接拼 `filename="${name}"`：HTTP 头只允许 latin1，含中文的响应头会让 Node
 * 抛 `ERR_INVALID_CHAR`，表现是 **接口 500、文件下载不下来**。而本项目的文件名经常带中文
 * （房间名进入迁移包名）与空格（备份包的「备注」），所以这里按 RFC 5987 同时给出：
 *   - `filename="..."`：ASCII 回退，紧邻 `filename*` 之后，老客户端与 curl -O 用它；
 *   - `filename*=UTF-8''...`：带编码的完整名字，现代浏览器优先采用。
 * 客户端优先取 `filename*`，因此两个值并存不会造成文件名错乱。
 */
export function buildContentDisposition(fileName: string): string {
  const sanitized = fileName.replace(/[\\"\r\n]/g, '_')
  const asciiFallback = ASCII_FILE_NAME_PATTERN.test(sanitized)
    ? sanitized
    : sanitized.replace(/[^\x20-\x7e]/g, '_')
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(sanitized)}`
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
  reply.header('Content-Disposition', buildContentDisposition(options.fileName))
  return reply.send(fs.createReadStream(options.filePath))
}
