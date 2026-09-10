import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PanelUpdateStatus } from '../../../shared/contracts/system.ts'
import {
  buildPanelUpdatePresentation,
  MANUAL_UPDATE_NOTE,
} from './panelUpdatePresentation.ts'

type StatusOverrides = Partial<Omit<PanelUpdateStatus, 'image' | 'release'>> & {
  image?: Partial<PanelUpdateStatus['image']>
  release?: PanelUpdateStatus['release']
}

function buildStatus(overrides: StatusOverrides = {}): PanelUpdateStatus {
  const { image, release, ...rest } = overrides
  return {
    runtimeMode: 'docker',
    image: {
      image: 'ghcr.io/pmat77/game-server-hub:v0.2.2',
      tag: 'v0.2.2',
      releaseVersion: 'v0.2.2',
      localDigest: 'sha256:1111',
      localDigestShort: '1111',
      remoteDigest: 'sha256:2222',
      remoteDigestShort: '2222',
      updateAvailable: true,
      localPresent: true,
      checkError: null,
      ...image,
    },
    release: release === undefined
      ? {
          tagName: 'v0.2.2',
          name: 'v0.2.2',
          body: '本 Release 的统一镜像……',
          publishedAt: '2026-09-08T00:00:00Z',
          htmlUrl: 'https://github.com/PMAT77/game-serve-hub/releases/tag/v0.2.2',
        }
      : release,
    lastCheckedAt: '2026-09-10T03:19:14.000Z',
    checking: false,
    updating: false,
    applySupported: true,
    imageApplySupported: false,
    applyHint: '未配置 GSH_STACK_DIR，无法一键更新面板。',
    updateKind: 'same-version-changed',
    manualUpdateCommand: 'cd /opt/game-server-hub && docker compose --env-file panel.env pull',
    checkError: null,
    ...rest,
  }
}

describe('buildPanelUpdatePresentation', () => {
  it('reports a higher release as a new version', () => {
    const view = buildPanelUpdatePresentation(buildStatus({
      updateKind: 'newer',
      release: {
        tagName: 'v0.3.0',
        name: 'v0.3.0',
        body: '',
        publishedAt: '2026-09-15T00:00:00Z',
        htmlUrl: 'https://github.com/PMAT77/game-serve-hub/releases/tag/v0.3.0',
      },
    }))
    assert.equal(view.versionLine, '当前版本：v0.2.2 · 有新版本 v0.3.0')
  })

  it('reports the same version with different image content', () => {
    const view = buildPanelUpdatePresentation(buildStatus())
    assert.equal(view.versionLine, '当前版本：v0.2.2 · 镜像内容有更新')
  })

  it('says it is up to date when the digests match', () => {
    const view = buildPanelUpdatePresentation(buildStatus({
      updateKind: 'none',
      image: { updateAvailable: false, remoteDigest: 'sha256:1111', remoteDigestShort: '1111' },
    }))
    assert.equal(view.versionLine, '当前版本：v0.2.2 · 已是最新')
  })

  it('asks for a manual command only when an update cannot be applied here', () => {
    assert.equal(buildPanelUpdatePresentation(buildStatus()).needsManualCommand, true)
    assert.equal(buildPanelUpdatePresentation(buildStatus({ imageApplySupported: true })).needsManualCommand, false)
    assert.equal(buildPanelUpdatePresentation(buildStatus({
      updateKind: 'none',
      image: { updateAvailable: false },
    })).needsManualCommand, false)
  })

  it('prioritises the in-progress state', () => {
    const view = buildPanelUpdatePresentation(buildStatus({ updating: true }))
    assert.equal(view.versionLine, '正在更新，面板约 30 秒后自动重启')
    assert.equal(view.needsManualCommand, false)
  })

  it('handles a null status without throwing', () => {
    const view = buildPanelUpdatePresentation(null)
    assert.equal(view.versionLine, '')
    assert.equal(view.needsManualCommand, false)
  })
})

describe('manual update note', () => {
  it('states the conclusion without deployment jargon', () => {
    assert.match(MANUAL_UPDATE_NOTE, /不支持面板内自动更新/)
    assert.doesNotMatch(MANUAL_UPDATE_NOTE, /digest|摘要|GSH_STACK_DIR|systemd|编排文件|compose/)
  })
})
