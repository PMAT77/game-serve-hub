import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getInstanceState, looksLikeRuntimeCommand } from './instanceDisplay.ts'
import { INSTANCE_STATE, INSTANCE_STATUS, MOD_ENABLED_STATUS, MOD_INSTALL_STATUS, SHARD_CONTAINER_STATUS, statusTagType } from '@/constants/statusDictionary'

describe('statusDictionary', () => {
  it('every descriptor has a non-empty label and a valid tone', () => {
    const groups = [
      Object.values(INSTANCE_STATE),
      Object.values(INSTANCE_STATUS),
      Object.values(SHARD_CONTAINER_STATUS),
      Object.values(MOD_INSTALL_STATUS),
      Object.values(MOD_ENABLED_STATUS),
    ]
    for (const group of groups) {
      for (const descriptor of group) {
        assert.ok(descriptor.label.trim().length > 0, `descriptor label must not be empty: ${JSON.stringify(descriptor)}`)
        assert.ok(['success', 'info', 'warning', 'error', 'neutral'].includes(descriptor.tone), `invalid tone: ${descriptor.tone}`)
      }
    }
  })

  it('maps tones to naive-ui tag types', () => {
    assert.equal(statusTagType('success'), 'success')
    assert.equal(statusTagType('info'), 'info')
    assert.equal(statusTagType('warning'), 'warning')
    assert.equal(statusTagType('error'), 'error')
    assert.equal(statusTagType('neutral'), 'default')
  })
})

describe('getInstanceState error split', () => {
  it('reports install failure for install-related errors', () => {
    const state = getInstanceState({ status: 'error', lastError: '安装失败：SteamCMD 退出码 8', lastCommand: null })
    assert.equal(state.key, 'install_failed')
    assert.equal(state.label, '安装失败')
  })

  it('reports runtime failure for runtime start commands', () => {
    const state = getInstanceState({
      status: 'error',
      lastError: '启动失败',
      lastCommand: './dontstarve_dedicated_server_nullrenderer_x64 -console',
    })
    assert.equal(state.key, 'runtime_error')
    assert.equal(state.label, '运行异常')
  })

  it('reports install failure by default when evidence is inconclusive', () => {
    const state = getInstanceState({ status: 'error', lastError: '未知错误', lastCommand: null })
    assert.equal(state.key, 'install_failed')
  })

  it('passes through non-error statuses from the dictionary', () => {
    assert.equal(getInstanceState({ status: 'running', lastError: null, lastCommand: null }).key, 'running')
    assert.equal(getInstanceState({ status: 'pending_install', lastError: null, lastCommand: null }).label, '未安装')
    assert.equal(getInstanceState({ status: 'installing', lastError: null, lastCommand: null }).label, '安装中')
  })
})

describe('looksLikeRuntimeCommand', () => {
  it('detects game server executables', () => {
    assert.equal(looksLikeRuntimeCommand('./dontstarve_dedicated_server_nullrenderer_x64'), true)
    assert.equal(looksLikeRuntimeCommand('bash launch.sh'), true)
    assert.equal(looksLikeRuntimeCommand('steamcmd +quit'), false)
    assert.equal(looksLikeRuntimeCommand(null), false)
    assert.equal(looksLikeRuntimeCommand('   '), false)
  })
})
