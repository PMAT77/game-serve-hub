import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultMasterServerIniFields } from './server-ini.ts'
import { DST_PORT_BLOCK_STRIDE, shouldReserveInstanceDstPorts } from './port-allocation.ts'
import { DST_DEFAULT_GAME_PORT } from './constants.ts'

describe('shouldReserveInstanceDstPorts', () => {
  it('reserves all instances by default', () => {
    assert.equal(shouldReserveInstanceDstPorts('stopped'), true)
    assert.equal(shouldReserveInstanceDstPorts('running'), true)
  })

  it('only reserves running instances when onlyRunning is set', () => {
    assert.equal(shouldReserveInstanceDstPorts('stopped', { onlyRunning: true }), false)
    assert.equal(shouldReserveInstanceDstPorts('running', { onlyRunning: true }), true)
    assert.equal(shouldReserveInstanceDstPorts('error', { onlyRunning: true }), false)
  })
})

describe('DST multi-instance port blocks', () => {
  it('offsets steam ports when gamePort differs from default', () => {
    const block1 = defaultMasterServerIniFields(DST_DEFAULT_GAME_PORT + DST_PORT_BLOCK_STRIDE)
    assert.equal(block1.serverPort, 11004)
    assert.equal(block1.steamAuthPort, 8771)
    assert.equal(block1.steamMasterPort, 12351)
  })
})
