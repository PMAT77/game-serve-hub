/**
 * 备份包大小与下载进度的展示口径。
 *
 * 表格「大小」列与本页下载进度必须用同一套换算，否则同一份包在两处会显示成不同数字。
 */

/** 人类可读的体积；无效值（<=0）对表格是「没有数据」，返回占位符 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '—'
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 下载进度文案。
 *
 * 下载响应是流式（chunked）的，浏览器拿不到响应体总长度，所以总量取列表里的
 * `BackupItem.sizeBytes`；它与磁盘实际大小若有偏差，只影响百分比的准确度，
 * 因此这里把百分比收在 0～99 —— 到 100% 反而说明用户看不到「还在传」。
 */
export function describeDownloadProgress(loadedBytes: number, totalBytes: number): string {
  const loaded = loadedBytes > 0 ? formatSize(loadedBytes) : '0 KB'
  if (totalBytes > 0) {
    const percent = Math.min(99, Math.max(0, Math.round((loadedBytes / totalBytes) * 100)))
    return `已接收 ${loaded} / ${formatSize(totalBytes)}（${percent}%）`
  }
  return `已接收 ${loaded}`
}
