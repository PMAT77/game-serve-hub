import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import {
  buildImageCandidates,
  buildImageRef,
  normalizeMirrorRegistries,
  OFFICIAL_UNIFIED_IMAGE_REPOSITORY,
} from './image-candidates.ts'
import { buildSteamcmdImageCandidates, resolvePanelSteamcmdPullRef } from './steamcmd-runner.ts'

describe('normalizeMirrorRegistries', () => {
  it('splits, trims and dedupes mirror registries', () => {
    assert.deepEqual(
      normalizeMirrorRegistries(' https://a.example.com, b.example.com/ ,a.example.com ,'),
      ['a.example.com', 'b.example.com'],
    )
    assert.deepEqual(normalizeMirrorRegistries(''), [])
    assert.deepEqual(normalizeMirrorRegistries(undefined), [])
  })
})

describe('buildImageRef', () => {
  it('omits docker.io prefix', () => {
    assert.equal(buildImageRef('docker.io', 'pmat77/game-server-hub', 'v1'), 'pmat77/game-server-hub:v1')
    assert.equal(buildImageRef('ghcr.io', 'pmat77/game-server-hub', 'v1'), 'ghcr.io/pmat77/game-server-hub:v1')
  })
})

describe('buildImageCandidates', () => {
  it('uses the configured image when mirrors are not configured', () => {
    assert.deepEqual(
      buildImageCandidates('registry.example.com/ns/game-server-hub:stable', ''),
      ['registry.example.com/ns/game-server-hub:stable'],
    )
  })

  it('prioritizes configured mirrors before the configured fallback', () => {
    assert.deepEqual(
      buildImageCandidates('ghcr.io/pmat77/game-server-hub:latest', 'docker.m.daocloud.io,hub-mirror.c.163.com'),
      [
        'docker.m.daocloud.io/pmat77/game-server-hub:latest',
        'hub-mirror.c.163.com/pmat77/game-server-hub:latest',
        'ghcr.io/pmat77/game-server-hub:latest',
      ],
    )
  })

  it('skips mirrors equal to the configured registry', () => {
    assert.deepEqual(
      buildImageCandidates('ghcr.io/pmat77/game-server-hub:latest', 'ghcr.io'),
      ['ghcr.io/pmat77/game-server-hub:latest'],
    )
  })

  it('falls back to the official unified repository when ref is empty', () => {
    assert.deepEqual(
      buildImageCandidates('', ''),
      [`${OFFICIAL_UNIFIED_IMAGE_REPOSITORY}:latest`],
    )
  })
})

describe('steamcmd pull ref helpers', () => {
  it('preserves the complete configured image reference', () => {
    assert.equal(
      resolvePanelSteamcmdPullRef('registry.cn-hangzhou.aliyuncs.com/game-server-hub/steamcmd-base:stable'),
      'registry.cn-hangzhou.aliyuncs.com/game-server-hub/steamcmd-base:stable',
    )
    assert.equal(
      resolvePanelSteamcmdPullRef('ghcr.io/pmat77/game-server-hub:latest'),
      `${OFFICIAL_UNIFIED_IMAGE_REPOSITORY}:latest`,
    )
    assert.equal(resolvePanelSteamcmdPullRef(''), `${OFFICIAL_UNIFIED_IMAGE_REPOSITORY}:latest`)
  })

  it('delegates candidates to the generic builder', () => {
    const previous = process.env.GSH_STEAMCMD_IMAGE_MIRRORS
    delete process.env.GSH_STEAMCMD_IMAGE_MIRRORS
    try {
      assert.deepEqual(
        buildSteamcmdImageCandidates('registry.example.com/ns/steamcmd-base:stable'),
        ['registry.example.com/ns/steamcmd-base:stable'],
      )
    }
    finally {
      if (previous === undefined) {
        delete process.env.GSH_STEAMCMD_IMAGE_MIRRORS
      }
      else {
        process.env.GSH_STEAMCMD_IMAGE_MIRRORS = previous
      }
    }
  })
})
