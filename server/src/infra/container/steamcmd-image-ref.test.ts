import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import {
  buildSteamcmdImageCandidates,
  resolvePanelSteamcmdPullRef,
  STEAMCMD_OFFICIAL_REPOSITORY,
} from './steamcmd-runner.ts'

describe('resolvePanelSteamcmdPullRef', () => {
  it('always resolves to GHCR steamcmd-base with tag from configured image', () => {
    assert.equal(
      resolvePanelSteamcmdPullRef('registry.example.com/ns/steamcmd-base:stable'),
      `${STEAMCMD_OFFICIAL_REPOSITORY}:stable`,
    )
    assert.equal(
      resolvePanelSteamcmdPullRef('ghcr.io/gameserverhub/steamcmd-base:latest'),
      `${STEAMCMD_OFFICIAL_REPOSITORY}:latest`,
    )
  })
})

describe('buildSteamcmdImageCandidates', () => {
  it('uses GHCR by default when mirrors are not configured', () => {
    const previous = process.env.GSH_STEAMCMD_IMAGE_MIRRORS
    delete process.env.GSH_STEAMCMD_IMAGE_MIRRORS
    try {
      assert.deepEqual(
        buildSteamcmdImageCandidates('registry.example.com/ns/steamcmd-base:stable'),
        [`${STEAMCMD_OFFICIAL_REPOSITORY}:stable`],
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

  it('prioritizes configured mirrors before GHCR fallback', () => {
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
