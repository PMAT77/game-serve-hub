import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSteamcmdMemoryLimitForLog,
  resolveSteamcmdContainerMemoryLimits,
} from './steamcmd-container-resources.ts'

describe('resolveSteamcmdContainerMemoryLimits', () => {
  it('defaults app-update to 8GiB without swap', () => {
    const prev = process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
    delete process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
    delete process.env.GSH_STEAMCMD_CONTAINER_MEMORY_SWAP_MB
    const limits = resolveSteamcmdContainerMemoryLimits('app-update')
    if (prev !== undefined) {
      process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB = prev
    }
    assert.ok(limits)
    assert.equal(limits!.Memory, 8192 * 1024 * 1024)
    assert.equal(limits!.MemorySwap, limits!.Memory)
  })

  it('returns undefined when memory limit set to 0', () => {
    process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB = '0'
    assert.equal(resolveSteamcmdContainerMemoryLimits('app-update'), undefined)
    delete process.env.GSH_STEAMCMD_CONTAINER_MEMORY_MB
  })
})

describe('formatSteamcmdMemoryLimitForLog', () => {
  it('formats GiB label', () => {
    const text = formatSteamcmdMemoryLimitForLog({
      Memory: 4 * 1024 * 1024 * 1024,
      MemorySwap: 4 * 1024 * 1024 * 1024,
    })
    assert.match(text, /4\.00 GiB/)
    assert.match(text, /禁用 swap/)
  })
})
