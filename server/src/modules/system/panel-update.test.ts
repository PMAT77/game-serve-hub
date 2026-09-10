import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { ServerConfig } from '../../shared/config'
import {
  hasStackRequiredFiles,
  resolveApplySupport,
  resolveStackPaths,
  isReleaseNewer,
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

describe('isReleaseNewer', () => {
  it('compares stable and prerelease versions without offering downgrades', () => {
    assert.equal(isReleaseNewer('v0.1.4', 'v0.2.0'), true)
    assert.equal(isReleaseNewer('v0.2.0', 'v0.1.4'), false)
    assert.equal(isReleaseNewer('v0.2.0-beta.1', 'v0.2.0'), true)
    assert.equal(isReleaseNewer('v0.2.0', 'v0.2.0-beta.1'), false)
  })
})
