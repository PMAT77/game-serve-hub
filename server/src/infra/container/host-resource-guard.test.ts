import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assessHostMemoryForHeavyOperation,
  resolveMinHostAvailableMbForOperation,
} from './host-resource-guard.ts'

describe('resolveMinHostAvailableMbForOperation', () => {
  it('steamcmd requirement uses planning peak not docker cap', () => {
    const prevMem = process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
    const prevHead = process.env.GSH_HOST_MEMORY_HEADROOM_MB
    const prevMin = process.env.GSH_HOST_MIN_AVAILABLE_MB
    const prevPlan = process.env.GSH_HOST_STEAMCMD_PLANNING_MB
    delete process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
    delete process.env.GSH_HOST_MEMORY_HEADROOM_MB
    delete process.env.GSH_HOST_MIN_AVAILABLE_MB
    delete process.env.GSH_HOST_STEAMCMD_PLANNING_MB
    const required = resolveMinHostAvailableMbForOperation('steamcmd-install')
    if (prevMem !== undefined) {
      process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB = prevMem
    }
    if (prevHead !== undefined) {
      process.env.GSH_HOST_MEMORY_HEADROOM_MB = prevHead
    }
    if (prevMin !== undefined) {
      process.env.GSH_HOST_MIN_AVAILABLE_MB = prevMin
    }
    if (prevPlan !== undefined) {
      process.env.GSH_HOST_STEAMCMD_PLANNING_MB = prevPlan
    }
    assert.equal(required, 1280 + 512)
  })
})

describe('assessHostMemoryForHeavyOperation', () => {
  it('skips check when /proc/meminfo unavailable', () => {
    const result = assessHostMemoryForHeavyOperation('dst-container-start')
    if (result.availableMb === null) {
      assert.equal(result.ok, true)
    }
  })
})

/**
 * 回归：原先守卫固定按单分片 512 MiB 估算，36 个 Mod 的双分片启动被轻易放行，
 * 然后在加载途中被内核 OOM 杀掉（线上主世界 anon-rss 已达 2.0 GiB 时死亡）。
 */
describe('DST 启动守卫按分片数与 Mod 数估算', () => {
  function withCleanEnv(run: () => void) {
    const keys = [
      'GSH_HOST_DST_PLANNING_MB',
      'GSH_HOST_MEMORY_HEADROOM_MB',
      'GSH_HOST_MIN_AVAILABLE_MB',
      'GSH_DST_CONTAINER_MEMORY_MB',
      'GSH_DST_CONTAINER_CPU_QUOTA',
    ]
    const saved = new Map<string, string | undefined>()
    for (const key of keys) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
    try {
      run()
    }
    finally {
      for (const [key, value] of saved) {
        if (value === undefined) {
          delete process.env[key]
        }
        else {
          process.env[key] = value
        }
      }
    }
  }

  it('单分片无 Mod 时保持原来的下限', () => {
    withCleanEnv(() => {
      process.env.GSH_HOST_DST_PLANNING_MB = '512'
      // 显式配置只作为下界：0 个 Mod 时就是 512 + 384 余量
      assert.equal(
        resolveMinHostAvailableMbForOperation('dst-container-start', { shardCount: 1, modCount: 0 }),
        512 + 384,
      )
    })
  })

  it('36 个 Mod 的双分片按真实规模要 3712 MiB，不再被放行', () => {
    withCleanEnv(() => {
      process.env.GSH_HOST_DST_PLANNING_MB = '512'
      // 单分片峰值 512 + 32×36 = 1664；双分片 3328；再加 384 MiB 余量
      assert.equal(
        resolveMinHostAvailableMbForOperation('dst-container-start', { shardCount: 2, modCount: 36 }),
        1664 * 2 + 384,
      )
    })
  })

  it('分片内存上限会钳住单分片估算', () => {
    withCleanEnv(() => {
      process.env.GSH_DST_CONTAINER_MEMORY_MB = '1024'
      assert.equal(
        resolveMinHostAvailableMbForOperation('dst-container-start', { shardCount: 1, modCount: 36 }),
        1024 + 384,
      )
    })
  })
})
