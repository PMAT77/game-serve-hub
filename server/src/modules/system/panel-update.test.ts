import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { ServerConfig } from '../../shared/config'
import {
  buildOfflineImageCommand,
  buildUpdaterShellCommand,
  hasStackRequiredFiles,
  isImageOutdated,
  isReleaseNewer,
  resolveApplySupport,
  resolveStackPaths,
  resolveTargetImageRef,
  resolveUpdateKind,
} from './panel-update'

const tempDirs: string[] = []

function createTempStackDir(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-stack-'))
  tempDirs.push(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '')
  }
  return dir
}

function buildConfig(partial: Partial<ServerConfig>): ServerConfig {
  return {
    mode: 'production',
    host: '0.0.0.0',
    port: 3000,
    dbPath: '/tmp/db.sqlite',
    logDir: '/tmp/logs',
    logLevel: 'info',
    envFile: '/tmp/.env.production',
    forcePasswordChange: false,
    adminUsername: 'admin',
    adminPassword: 'admin',
    adminPasswordGenerated: false,
    dockerHost: 'unix:///var/run/docker.sock',
    instancesRoot: '/tmp/instances',
    backupsRoot: '/tmp/backups',
    gameDstImage: 'ghcr.io/pmat77/game-server-hub:latest',
    steamcmdImage: 'ghcr.io/pmat77/game-server-hub:latest',
    imageMirrors: [],
    edition: 'community',
    runtimeMode: 'docker',
    nativeRuntimeDir: '/tmp/runtime',
    nativeSteamcmdPath: '/opt/game-server-hub/runtime/steamcmd/steamcmd.sh',
    nativeSystemdUnitDir: '/tmp/systemd',
    panelImage: 'ghcr.io/pmat77/game-server-hub:latest',
    stackDir: '',
    composeFiles: ['docker-compose.yml', 'docker-compose.bind.yml'],
    panelContainerName: 'game-server-hub-panel',
    trustedProxies: [],
    installPathPolicy: 'instances-root',
    githubRepo: 'PMAT77/game-serve-hub',
    releaseVersion: '',
    buildSha: '',
    syncAdminPasswordFromEnv: false,
    passwordRecoveryToken: '',
    corsOrigin: false,
    ...partial,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('hasStackRequiredFiles', () => {
  it('requires panel.env and all compose files', () => {
    const dir = createTempStackDir(['panel.env', 'docker-compose.yml'])
    assert.equal(hasStackRequiredFiles(dir, ['docker-compose.yml']), true)
    assert.equal(hasStackRequiredFiles(dir, ['docker-compose.yml', 'docker-compose.bind.yml']), false)
  })
})

describe('resolveStackPaths', () => {
  it('uses host dir when files are directly accessible', () => {
    const hostDir = createTempStackDir(['panel.env', 'docker-compose.yml', 'docker-compose.bind.yml'])
    assert.deepEqual(resolveStackPaths(hostDir, ['docker-compose.yml', 'docker-compose.bind.yml']), {
      hostDir,
      localDir: hostDir,
    })
  })

  it('falls back to container mount when host path is not visible in process', () => {
    const hostDir = '/opt/game-server-hub'
    const mountDir = createTempStackDir(['panel.env', 'docker-compose.yml'])
    assert.deepEqual(resolveStackPaths(hostDir, ['docker-compose.yml'], mountDir), {
      hostDir,
      localDir: mountDir,
    })
  })

  it('returns null when stack files are missing everywhere', () => {
    const hostDir = createTempStackDir([])
    assert.equal(resolveStackPaths(hostDir, ['docker-compose.yml']), null)
  })
})

describe('resolveApplySupport', () => {
  it('still supports image pull when stack dir is missing', () => {
    const support = resolveApplySupport(buildConfig({ stackDir: '' }))
    assert.equal(support.imageSupported, false)
    assert.equal(support.supported, true)
    assert.match(support.hint ?? '', /GSH_STACK_DIR/)
  })

  it('uses the verified installer path for Native upgrades', () => {
    const support = resolveApplySupport(buildConfig({ runtimeMode: 'native' }))
    assert.equal(support.imageSupported, false)
    assert.equal(support.supported, false)
    assert.match(support.hint ?? '', /安装脚本/)
  })

  it('enables image apply when stack files are reachable', () => {
    const hostDir = createTempStackDir(['panel.env', 'docker-compose.yml', 'docker-compose.bind.yml'])
    const support = resolveApplySupport(buildConfig({ stackDir: hostDir }))
    assert.equal(support.imageSupported, true)
    assert.equal(support.hint, null)
    assert.equal(support.stackPaths?.hostDir, hostDir)
    assert.equal(support.stackPaths?.localDir, hostDir)
  })
})

describe('resolveUpdateKind', () => {
  it('separates a newer release from the same version with different image content', () => {
    assert.equal(resolveUpdateKind({
      runtimeMode: 'docker',
      updateAvailable: true,
      currentVersion: 'v0.2.1',
      latestVersion: 'v0.2.2',
    }), 'newer')
    assert.equal(resolveUpdateKind({
      runtimeMode: 'docker',
      updateAvailable: true,
      currentVersion: 'v0.2.2',
      latestVersion: 'v0.2.2',
    }), 'same-version-changed')
    assert.equal(resolveUpdateKind({
      runtimeMode: 'docker',
      updateAvailable: true,
      currentVersion: '0.2.2',
      latestVersion: 'v0.2.2',
    }), 'same-version-changed')
  })

  it('never claims an update when the digests match', () => {
    assert.equal(resolveUpdateKind({
      runtimeMode: 'docker',
      updateAvailable: false,
      currentVersion: 'v0.2.2',
      latestVersion: 'v0.2.2',
    }), 'none')
  })

  it('stays unknown when the release tag cannot be read', () => {
    assert.equal(resolveUpdateKind({
      runtimeMode: 'docker',
      updateAvailable: true,
      currentVersion: 'v0.2.2',
      latestVersion: null,
    }), 'unknown')
    assert.equal(resolveUpdateKind({
      runtimeMode: 'docker',
      updateAvailable: true,
      currentVersion: null,
      latestVersion: 'v0.2.2',
    }), 'unknown')
  })

  it('treats a native upgrade as a plain newer version', () => {
    assert.equal(resolveUpdateKind({
      runtimeMode: 'native',
      updateAvailable: true,
      currentVersion: 'v0.2.1',
      latestVersion: 'v0.2.2',
    }), 'newer')
    assert.equal(resolveUpdateKind({
      runtimeMode: 'native',
      updateAvailable: false,
      currentVersion: 'v0.2.2',
      latestVersion: 'v0.2.2',
    }), 'none')
  })
})

describe('isReleaseNewer', () => {
  it('compares stable and prerelease versions without offering downgrades', () => {
    assert.equal(isReleaseNewer('v0.1.4', 'v0.2.0'), true)
    assert.equal(isReleaseNewer('v0.2.0', 'v0.1.4'), false)
    assert.equal(isReleaseNewer('v0.2.0-beta.1', 'v0.2.0'), true)
    assert.equal(isReleaseNewer('v0.2.0', 'v0.2.0-beta.1'), false)
  })
})

describe('isImageOutdated', () => {
  // docker pull 在本地记录 manifest list 摘要，registry 的 HEAD 返回同一个值；
  // 平台清单摘要、config 摘要与未压缩层摘要是同一镜像的另外几种写法。
  const indexDigest = `sha256:${'1'.repeat(64)}`
  const platformDigest = `sha256:${'2'.repeat(64)}`
  const configDigest = `sha256:${'3'.repeat(64)}`
  const otherDigest = `sha256:${'4'.repeat(64)}`
  const layers = [`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`]
  const remote = { digests: [indexDigest, platformDigest, configDigest], layers }

  it('accepts a local manifest list digest as the same image as its platform digests', () => {
    assert.equal(isImageOutdated({ local: { digests: [indexDigest], layers }, remote }), false)
  })

  it('accepts a local image pinned to a platform digest', () => {
    assert.equal(isImageOutdated({ local: { digests: [platformDigest], layers }, remote }), false)
  })

  it('accepts an offline image whose config digest still matches', () => {
    assert.equal(isImageOutdated({ local: { digests: [configDigest], layers }, remote }), false)
  })

  it('accepts an offline image whose config digest was rewritten but layers match', () => {
    assert.equal(isImageOutdated({
      local: { digests: [otherDigest], layers },
      remote,
    }), false)
  })

  it('reports an update when neither digests nor layers line up', () => {
    assert.equal(isImageOutdated({
      local: { digests: [otherDigest], layers: [`sha256:${'c'.repeat(64)}`] },
      remote,
    }), true)
  })

  it('reports an update when the layer list differs', () => {
    assert.equal(isImageOutdated({
      local: { digests: [otherDigest], layers: [...layers, `sha256:${'c'.repeat(64)}`] },
      remote,
    }), true)
  })

  it('pulls when the image is missing locally', () => {
    assert.equal(isImageOutdated({ local: { digests: [], layers: [] }, remote }), true)
  })

  it('never claims an update when the registry could not be read', () => {
    assert.equal(isImageOutdated({
      local: { digests: [indexDigest], layers },
      remote: { digests: [], layers: [] },
    }), false)
  })
})

describe('resolveTargetImageRef', () => {
  it('targets the release tag so a one-click update actually crosses versions', () => {
    assert.equal(
      resolveTargetImageRef('v0.3.3', 'ghcr.io/pmat77/game-server-hub:v0.3.2'),
      'ghcr.io/pmat77/game-server-hub:v0.3.3',
    )
  })

  it('falls back to the configured tag when the release cannot be read', () => {
    assert.equal(
      resolveTargetImageRef(null, 'ghcr.io/pmat77/game-server-hub:v0.3.2'),
      'ghcr.io/pmat77/game-server-hub:v0.3.2',
    )
    assert.equal(
      resolveTargetImageRef('not-a-tag', 'ghcr.io/pmat77/game-server-hub:v0.3.2'),
      'ghcr.io/pmat77/game-server-hub:v0.3.2',
    )
  })

  it('keeps the registry and repository of the configured image', () => {
    assert.equal(
      resolveTargetImageRef('v0.3.3', 'registry.example.com:5000/gsh/panel:dev'),
      'registry.example.com:5000/gsh/panel:v0.3.3',
    )
  })
})

describe('buildOfflineImageCommand', () => {
  it('points at the release asset and how to load it', () => {
    const command = buildOfflineImageCommand('PMAT77/game-serve-hub', 'v0.3.3') ?? ''
    assert.match(command, /releases\/download\/v0\.3\.3\/game-server-hub-v0\.3\.3-docker-image\.tar\.gz/)
    assert.match(command, /gunzip -c game-server-hub-v0\.3\.3-docker-image\.tar\.gz \| docker load/)
  })

  it('returns null without a release tag or repo', () => {
    assert.equal(buildOfflineImageCommand('PMAT77/game-serve-hub', null), null)
    assert.equal(buildOfflineImageCommand('', 'v0.3.3'), null)
  })
})

describe('buildUpdaterShellCommand', () => {
  it('writes the target image into panel.env and rebuilds without pulling', () => {
    const script = buildUpdaterShellCommand('ghcr.io/pmat77/game-server-hub:v0.3.3', 'v0.3.3', buildConfig({}))
    assert.match(script, /PANEL_IMAGE=ghcr\.io\/pmat77\/game-server-hub:v0\.3\.3/)
    assert.match(script, /GSH_GAME_DST_IMAGE=ghcr\.io\/pmat77\/game-server-hub:v0\.3\.3/)
    assert.match(script, /GSH_STEAMCMD_IMAGE=ghcr\.io\/pmat77\/game-server-hub:v0\.3\.3/)
    assert.match(script, /GSH_RELEASE_VERSION=v0\.3\.3/)
    assert.match(script, /cp panel\.env "\$backup"/)
    assert.match(script, /up -d panel/)
    // 目标镜像此刻必然已在本地：多一次 pull 只会在国内网络下白等或直接失败
    assert.doesNotMatch(script, /compose[^\n]*pull/)
  })

  it('keeps every compose file of the stack in the rebuild command', () => {
    const script = buildUpdaterShellCommand('img:v1', 'v1', buildConfig({
      composeFiles: ['docker-compose.yml', 'docker-compose.bind.yml'],
    }))
    assert.match(script, /-f \/stack\/docker-compose\.yml/)
    assert.match(script, /-f \/stack\/docker-compose\.bind\.yml/)
  })
})
