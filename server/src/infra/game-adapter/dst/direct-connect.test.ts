import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { clearDstConnectHostCache } from './connect-host'
import { ensureDstClusterConfig } from './cluster-config'
import {
  buildDstConnectInfo,
  buildDstDirectConnectCommand,
} from './direct-connect'

describe('direct-connect', () => {
  it('buildDstDirectConnectCommand omits password when empty', () => {
    assert.equal(buildDstDirectConnectCommand('192.168.1.8', 10999), 'c_connect("192.168.1.8", 10999)')
  })

  it('buildDstDirectConnectCommand escapes quotes in password', () => {
    assert.equal(
      buildDstDirectConnectCommand('10.0.0.1', 10999, 'say "hi"'),
      'c_connect("10.0.0.1", 10999, "say \\"hi\\"")',
    )
  })

  it('buildDstConnectInfo returns structured connect payload', async () => {
    const previous = process.env.GSH_DST_CONNECT_HOST
    process.env.GSH_DST_CONNECT_HOST = '203.0.113.10'
    clearDstConnectHostCache()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-direct-connect-'))
    ensureDstClusterConfig(dir, { instanceName: 'Test Room', gamePort: 11001 })
    try {
      const info = await buildDstConnectInfo(dir, { gamePort: 11001, running: true })
      assert.equal(info.roomName, 'Test Room')
      assert.equal(info.port, 11001)
      assert.equal(info.host, '203.0.113.10')
      assert.ok(info.command.includes('c_connect('))
      assert.match(info.localCommand, /127\.0\.0\.1/)
      assert.ok(info.udpPorts.includes(11001))
      assert.equal(info.running, true)
    }
    finally {
      clearDstConnectHostCache()
      if (previous === undefined) {
        delete process.env.GSH_DST_CONNECT_HOST
      }
      else {
        process.env.GSH_DST_CONNECT_HOST = previous
      }
    }
  })
})
