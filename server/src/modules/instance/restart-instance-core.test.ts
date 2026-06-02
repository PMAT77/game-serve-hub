import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import Fastify from 'fastify'
import { restartInstanceCore } from './restart-instance-core'

describe('restartInstanceCore', () => {
  it('returns business error when instance id is empty', async () => {
    const app = Fastify()
    const request = { headers: {} } as Parameters<typeof restartInstanceCore>[1]
    const result = await restartInstanceCore(app, request, '  ')
    assert.equal('error' in result && result.error, '实例 ID 不能为空')
    await app.close()
  })

})
