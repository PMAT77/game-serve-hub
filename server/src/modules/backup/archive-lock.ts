/** 实例存档文件操作互斥锁：导入与恢复共用，防同实例并发目录操作交错损坏 */

const instanceArchiveLocks = new Set<string>()

/** 同实例存档文件操作（导入/恢复）并发时抛出，调用方应转为业务错误 */
export class InstanceArchiveBusyError extends Error {
  constructor() {
    super('该实例正在执行存档导入或恢复操作，请稍后再试')
    this.name = 'InstanceArchiveBusyError'
  }
}

/**
 * 在实例级存档文件锁内执行 fn；同实例并发时抛 InstanceArchiveBusyError。
 * 锁不可重入：锁内不得再次调用包裹了同一把锁的入口（导入内部的安全备份走
 * createInstanceBackup，不经过锁，因此安全）。
 */
export async function withInstanceArchiveOperationLock<T>(
  instanceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (instanceArchiveLocks.has(instanceId)) {
    throw new InstanceArchiveBusyError()
  }
  instanceArchiveLocks.add(instanceId)
  try {
    return await fn()
  }
  finally {
    instanceArchiveLocks.delete(instanceId)
  }
}
