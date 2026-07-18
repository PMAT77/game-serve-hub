import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import {
  buildSteamcmdImageCandidates,
  resolvePanelSteamcmdPullRef,
  STEAMCMD_OFFICIAL_REPOSITORY,
} from './steamcmd-runner.ts'

describe('resolvePanelSteamcmdPullRef', () => {
  it('preserves the complete configured image reference', () => {
    assert.equal(
      resolvePanelSteamcmdPullRef('registry.cn-hangzhou.aliyuncs.com/game-server-hub/steamcmd-base:stable'),
      'registry.cn-hangzhou.aliyuncs.com/game-server-hub/steamcmd-base:stable',
    )
    assert.equal(
      resolvePanelSteamcmdPullRef('ghcr.io/gameserverhub/steamcmd-base:latest'),
      `${STEAMCMD_OFFICIAL_REPOSITORY}:latest`,
    )
    assert.equal(resolvePanelSteamcmdPullRef(''), `${STEAMCMD_OFFICIAL_REPOSITORY}:latest`)
  })
})

describe('buildSteamcmdImageCandidates', () => {
  it('uses the configured image when mirrors are not configured', () => {
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

  it('prioritizes configured mirrors before the configured fallback', () => {
    const previous = process.env.GSH_STEAMCMD_IMAGE_MIRRORS
    process.env.GSH_STEAMCMD_IMAGE_MIRRORS = 'docker.m.daocloud.io,hub-mirror.c.163.com'
    try {
      assert.deepEqual(
        buildSteamcmdImageCandidates('ghcr.io/gameserverhub/steamcmd-base:latest'),
        [
          'docker.m.daocloud.io/gameserverhub/steamcmd-base:latest',
          'hub-mirror.c.163.com/gameserverhub/steamcmd-base:latest',
          `${STEAMCMD_OFFICIAL_REPOSITORY}:latest`,
        ],
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
