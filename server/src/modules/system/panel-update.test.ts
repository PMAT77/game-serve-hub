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
    gameDstImage: 'ghcr.io/gameserverhub/game-server-hub-dst:latest',
    steamcmdImage: 'ghcr.io/gameserverhub/steamcmd-base:latest',
    edition: 'community',
    panelImage: 'ghcr.io/gameserverhub/game-server-hub:latest',
    stackDir: '',
    composeFiles: ['docker-compose.yml', 'docker-compose.bind.yml'],
    panelContainerName: 'game-server-hub-panel',
    githubRepo: 'GameServerHub/game-server-hub',
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
  it('allows dst apply when stack dir is missing', () => {
    const support = resolveApplySupport(buildConfig({ stackDir: '' }))
    assert.equal(support.panelSupported, false)
    assert.equal(support.dstSupported, true)
    assert.equal(support.supported, true)
    assert.match(support.hint ?? '', /GSH_STACK_DIR/)
  })

  it('enables panel apply when stack files are reachable', () => {
    const hostDir = createTempStackDir(['panel.env', 'docker-compose.yml', 'docker-compose.bind.yml'])
    const support = resolveApplySupport(buildConfig({ stackDir: hostDir }))
    assert.equal(support.panelSupported, true)
    assert.equal(support.dstSupported, true)
    assert.equal(support.hint, null)
    assert.equal(support.stackPaths?.hostDir, hostDir)
    assert.equal(support.stackPaths?.localDir, hostDir)
  })
})
