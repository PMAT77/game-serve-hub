import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveDockerStatus } from '../../infra/docker.ts'
import { clearRemoteBuildCache, fetchRemoteBuildId, readLocalBuildId } from './build-id.ts'

describe('fetchRemoteBuildId', () => {
  it('returns null when Docker is stopped (no host SteamCMD fallback)', async () => {
    if ((await resolveDockerStatus()) === 'running') {
      return
    }
    clearRemoteBuildCache('343050')
    const result = await fetchRemoteBuildId('steamcmd', '343050', { force: true })
    assert.equal(result, null)
  })
})

describe('readLocalBuildId', () => {
  it('returns null when manifest is missing', () => {
    assert.equal(readLocalBuildId('/nonexistent/path', '343050'), null)
  })
})
