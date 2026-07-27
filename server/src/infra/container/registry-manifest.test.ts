import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBearerChallenge,
  pickManifestDigestFromIndex,
  resolvePreferredPlatform,
} from './registry-manifest.ts'

describe('registry-manifest', () => {
  it('parses bearer challenge header', () => {
    const challenge = parseBearerChallenge(
      'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:pmat77/game-server-hub:pull"',
    )
    assert.deepEqual(challenge, {
      realm: 'https://ghcr.io/token',
      service: 'ghcr.io',
      scope: 'repository:pmat77/game-server-hub:pull',
    })
  })

  it('picks platform digest from manifest index', () => {
    const preferred = resolvePreferredPlatform()
    const digest = pickManifestDigestFromIndex({
      manifests: [
        {
          digest: 'sha256:attestation',
          platform: { os: 'unknown', architecture: 'unknown' },
        },
        {
          digest: 'sha256:linux-amd64',
          platform: { os: 'linux', architecture: preferred.architecture },
        },
      ],
    })
    assert.equal(digest, 'sha256:linux-amd64')
  })

  it('falls back to linux digest without explicit architecture', () => {
    const digest = pickManifestDigestFromIndex({
      manifests: [
        {
          digest: 'sha256:linux-default',
          platform: { os: 'linux' },
        },
      ],
    })
    assert.equal(digest, 'sha256:linux-default')
  })
})
