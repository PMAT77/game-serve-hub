import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RuntimeEnvironmentInput } from './steamcmdPanelPresentation.ts'
import {
  resolveRuntimeEnvironmentView,
  SPLIT_IMAGE_NOTE,
  UNIFIED_IMAGE_LABEL,
  UNIFIED_IMAGE_NOTE,
} from './steamcmdPanelPresentation.ts'

const UNIFIED_REF = 'ghcr.io/pmat77/game-server-hub:v0.4.1'

function baseInput(overrides: Partial<RuntimeEnvironmentInput> = {}): RuntimeEnvironmentInput {
  return {
    isNativeMode: false,
    runtimeAvailable: true,
    steamcmdInstalled: true,
    gameDstInstalled: true,
    steamcmdImage: UNIFIED_REF,
    gameDstImage: UNIFIED_REF,
    ...overrides,
  }
}

function tagTexts(input: RuntimeEnvironmentInput): string[] {
  return resolveRuntimeEnvironmentView(input).tags.map(tag => tag.text)
}

describe('resolveRuntimeEnvironmentView', () => {
  it('Docker 同源：合并为一行镜像与一条镜像就绪标签', () => {
    const view = resolveRuntimeEnvironmentView(baseInput())

    assert.equal(view.imageUnified, true)
    assert.deepEqual(view.imageRows, [{ label: UNIFIED_IMAGE_LABEL, value: UNIFIED_REF }])
    assert.equal(view.imageNote, UNIFIED_IMAGE_NOTE)
    assert.deepEqual(tagTexts(baseInput()), ['Docker 可用', '统一镜像已就绪'])
    assert.equal(view.primaryActionLabel, '准备运行镜像')
    assert.equal(view.secondaryPullVisible, false)
    assert.equal(view.hint, null)
  })

  it('Docker 同源且镜像缺失：标签与提示都指向统一镜像', () => {
    const view = resolveRuntimeEnvironmentView(baseInput({
      steamcmdInstalled: false,
      gameDstInstalled: false,
    }))

    assert.deepEqual(tagTexts(baseInput({ steamcmdInstalled: false, gameDstInstalled: false })), ['Docker 可用', '统一镜像未就绪'])
    assert.equal(view.hint?.tone, 'warning')
    assert.match(view.hint?.text ?? '', /统一镜像/)
  })

  it('Docker 异构：退回两行镜像与三条标签，并提示会被同步', () => {
    const input = baseInput({
      steamcmdInstalled: true,
      gameDstInstalled: false,
      gameDstImage: 'ghcr.io/pmat77/game-server-hub:v0.3.10',
    })
    const view = resolveRuntimeEnvironmentView(input)

    assert.equal(view.imageUnified, false)
    assert.deepEqual(view.imageRows, [
      { label: '游戏安装镜像', value: UNIFIED_REF },
      { label: '游戏运行镜像', value: 'ghcr.io/pmat77/game-server-hub:v0.3.10' },
    ])
    assert.equal(view.imageNote, SPLIT_IMAGE_NOTE)
    assert.deepEqual(tagTexts(input), ['Docker 可用', 'SteamCMD 已就绪', '安装实例后自动准备'])
    assert.equal(view.secondaryPullVisible, true)
  })

  it('Docker 异构时运行镜像已就绪也单独成标签', () => {
    const input = baseInput({
      steamcmdInstalled: false,
      gameDstInstalled: true,
      steamcmdImage: '',
    })

    assert.deepEqual(tagTexts(input), ['Docker 可用', 'SteamCMD 未就绪', 'DST 运行镜像已就绪'])
  })

  it('两侧均为空不误判为同源，也不误报已就绪', () => {
    const input = baseInput({ steamcmdImage: '', gameDstImage: '' })
    const view = resolveRuntimeEnvironmentView(input)

    assert.equal(view.imageUnified, false)
    assert.equal(view.imageRows.length, 2)
    assert.deepEqual(tagTexts(input), ['Docker 可用', 'SteamCMD 已就绪', 'DST 运行镜像已就绪'])
  })

  it('只有一侧为空按异构处理', () => {
    const view = resolveRuntimeEnvironmentView(baseInput({ gameDstImage: '' }))

    assert.equal(view.imageUnified, false)
    assert.equal(view.imageRows[1]?.value, '')
  })

  it('首尾空格不影响同源判定', () => {
    const view = resolveRuntimeEnvironmentView(baseInput({ steamcmdImage: ` ${UNIFIED_REF} `, gameDstImage: UNIFIED_REF }))

    assert.equal(view.imageUnified, true)
  })

  it('Docker 不可用时给出连接排障提示，而不是「镜像未就绪」提示', () => {
    const input = baseInput({
      runtimeAvailable: false,
      steamcmdInstalled: false,
      gameDstInstalled: false,
    })
    const view = resolveRuntimeEnvironmentView(input)

    assert.deepEqual(tagTexts(input), ['Docker 不可用', '统一镜像未就绪'])
    assert.equal(view.hint?.tone, 'error')
    assert.match(view.hint?.text ?? '', /无法连接 Docker/)
  })

  it('Native 模式：SteamCMD 路径单行、无运行镜像行与 Docker 标签', () => {
    const input = baseInput({
      isNativeMode: true,
      steamcmdImage: '/opt/game-server-hub/runtime/steamcmd/steamcmd.sh',
      gameDstImage: '',
    })
    const view = resolveRuntimeEnvironmentView(input)

    assert.equal(view.imageUnified, false)
    assert.deepEqual(view.imageRows, [{ label: 'SteamCMD 路径', value: '/opt/game-server-hub/runtime/steamcmd/steamcmd.sh' }])
    assert.equal(view.imageNote, '')
    assert.deepEqual(tagTexts(input), ['systemd 可用', 'SteamCMD 已就绪', '游戏进程由 systemd 管理'])
    assert.equal(view.primaryActionLabel, '检查 SteamCMD')
    assert.equal(view.secondaryPullVisible, false)
    assert.equal(view.hint, null)
  })

  it('Native 模式且运行环境不可用：提示 systemd 排障', () => {
    const view = resolveRuntimeEnvironmentView(baseInput({
      isNativeMode: true,
      runtimeAvailable: false,
      steamcmdInstalled: false,
    }))

    assert.equal(view.hint?.tone, 'error')
    assert.match(view.hint?.text ?? '', /systemd/)
  })
})
