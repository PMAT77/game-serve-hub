import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildServerIni,
  defaultCavesServerIniFields,
  defaultMasterServerIniFields,
  findPortConflictsBetweenShards,
  parseServerIni,
  validateServerIniFields,
} from './server-ini'

describe('server-ini', () => {
  it('parses and rebuilds master server.ini', () => {
    const fields = defaultMasterServerIniFields(10999)
    const content = buildServerIni(fields)
    const parsed = parseServerIni(content, 'master')
    assert.equal(parsed.fields.serverPort, 10999)
    assert.equal(parsed.fields.isMaster, true)
    assert.equal(parsed.fields.steamAuthPort, 8766)
  })

  it('defaults caves ports offset from master', () => {
    const master = defaultMasterServerIniFields(10999)
    const caves = defaultCavesServerIniFields(master)
    assert.equal(caves.serverPort, 11000)
    assert.equal(caves.steamAuthPort, 8768)
    assert.equal(caves.isMaster, false)
  })

  it('detects port conflicts between shards', () => {
    const master = defaultMasterServerIniFields(10999)
    const caves = { ...defaultCavesServerIniFields(master), serverPort: 10999 }
    const errors = findPortConflictsBetweenShards(master, caves)
    assert.ok(errors.length > 0)
    assert.match(errors.join(' '), /10999/)
  })

  it('rejects caves with is_master true', () => {
    const fields = defaultCavesServerIniFields(defaultMasterServerIniFields())
    fields.isMaster = true
    const errors = validateServerIniFields(fields, 'caves')
    assert.ok(errors.some(e => e.includes('is_master')))
  })
})
