import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  directoryListQuerySchema,
  directorySearchQuerySchema,
  networkConfigRequestSchema,
  panelSettingsRequestSchema,
  panelUpdateApplyRequestSchema,
  steamcmdConfigRequestSchema,
} from '../../../../shared/contracts/system'

describe('system API contracts', () => {
  it('normalizes optional settings and filesystem inputs', () => {
    assert.deepEqual(panelSettingsRequestSchema.parse({
      panelPort: 8080,
      theme: 'dark',
    }), {
      panelPort: 8080,
      theme: 'dark',
    })
    assert.deepEqual(directoryListQuerySchema.parse({ path: ' C:\\games ' }), {
      path: 'C:\\games',
    })
    assert.deepEqual(directorySearchQuerySchema.parse({ keyword: ' steamcmd ' }), {
      keyword: 'steamcmd',
    })
  })

  it('rejects invalid typed payloads before route logic', () => {
    assert.equal(panelSettingsRequestSchema.safeParse({ panelPort: 0 }).success, false)
    assert.equal(steamcmdConfigRequestSchema.safeParse({ installRoot: '' }).success, false)
    assert.equal(networkConfigRequestSchema.safeParse({
      tls: { provider: 'invalid' },
    }).success, false)
    assert.equal(panelUpdateApplyRequestSchema.safeParse({
      targets: ['panel', 'unknown'],
    }).success, false)
  })
})
