import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDockerStatus } from '../../infra/docker.ts'
import { ensureContainerRuntimeReady } from './container-lifecycle.ts'

describe('ensureContainerRuntimeReady', () => {
  it('returns ok=false with message when Docker is stopped', async () => {
    if ((await resolveDockerStatus()) === 'running') {
      return
    }
    const result = await ensureContainerRuntimeReady()
    assert.equal(result.ok, false)
    assert.match(result.message ?? '', /Docker/)
  })

  it('returns structured readiness result', async () => {
    const result = await ensureContainerRuntimeReady()
    assert.equal(typeof result.ok, 'boolean')
    if (!result.ok) {
      assert.ok(result.message && result.message.length > 0)
    }
  })
})
