import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { DbGameInstance } from '../../../shared/db/index'
import { ensureDstClusterConfig } from './cluster-config'
import { resolveClusterPaths, saveClusterConfig } from './cluster-service'
import { parseLeveldataOverrides } from './leveldata-override'
import { initCavesShard, saveShardConfig } from './shard-service'
import { isCavesShardConfigured, isShardWorldGenerated, resolveShardLeveldataPath, resolveShardSaveDir } from './shard-layout'
const tempDirs: string[] = []

function makeTempInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-shard-svc-'))
  tempDirs.push(dir)
  return dir
}

function makeInstance(installPath: string, overrides: Partial<DbGameInstance> = {}): DbGameInstance {
  return {
    id: 'test-instance',
    name: 'Test',
    nodeId: 'local-node',
    gameCode: '343050',
    status: 'stopped',
    installPath,
    gamePort: 10999,
    containerId: null,
    runtimePid: null,
    runtimeStartedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as DbGameInstance
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('shard-service', () => {
  it('initCavesShard creates caves config idempotently', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { instanceName: 'Test', gamePort: 10999 })
    const instance = makeInstance(installPath)
    const first = initCavesShard(instance)
    assert.equal(first.alreadyConfigured, false)
    assert.equal(isCavesShardConfigured(installPath), true)
    const second = initCavesShard(instance)
    assert.equal(second.alreadyConfigured, true)
  })

  it('saveShardConfig rejects conflicting caves port', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    const instance = makeInstance(installPath)
    saveClusterConfig(instance, {
      instanceId: instance.id,
      networkMode: 'offline',
      clusterName: 'Shard Room',
      clusterDescription: '',
      clusterPassword: '',
      gameMode: 'survival',
      maxPlayers: 6,
      pvp: false,
      pauseWhenEmpty: true,
      voteEnabled: true,
      clusterIntention: 'cooperative',
      tickRate: 15,
      maxSnapshots: 6,
      shardEnabled: true,
      bindIp: '127.0.0.1',
      masterIp: '127.0.0.1',
      masterPort: 10888,
      clusterKey: 'secret-key',
      steamGroupOnly: false,
      steamGroupId: '0',
      steamGroupAdmins: false,
    })
    assert.throws(
      () => saveShardConfig(instance, {
        instanceId: instance.id,
        shard: 'caves',
        serverPort: 10999,
        steamAuthPort: 8768,
        steamMasterPort: 12348,
        worldgenPreset: 'DST_CAVE',
      }),
      /不能相同|重复/,
    )
  })

  it('rejects saving caves when room shard is disabled', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    const instance = makeInstance(installPath)
    initCavesShard(instance)
    assert.throws(
      () => saveShardConfig(instance, {
        instanceId: instance.id,
        shard: 'caves',
        serverPort: 11000,
        steamAuthPort: 8768,
        steamMasterPort: 12348,
        worldgenPreset: 'DST_CAVE',
      }),
      /洞穴未开启/,
    )
  })

  it('saveShardConfig writes master worldgen', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    const instance = makeInstance(installPath)
    saveShardConfig(instance, {
      instanceId: instance.id,
      shard: 'master',
      serverPort: 11001,
      steamAuthPort: 8766,
      steamMasterPort: 12346,
      worldgenPreset: 'SURVIVAL_TOGETHER',
    })
    const { clusterRoot } = resolveClusterPaths(installPath)
    const ini = fs.readFileSync(path.join(clusterRoot, 'Master', 'server.ini'), 'utf8')
    assert.match(ini, /server_port = 11001/)
  })

  it('saveShardConfig writes master world rules to leveldataoverride.lua', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    const instance = makeInstance(installPath)
    saveShardConfig(instance, {
      instanceId: instance.id,
      shard: 'master',
      serverPort: 10999,
      steamAuthPort: 8766,
      steamMasterPort: 12346,
      worldgenPreset: 'SURVIVAL_TOGETHER',
      worldRuleOverrides: { krampus: 'often', day: 'longer' },
      worldgenOverrides: { branching: 'most' },
    })
    const luaPath = resolveShardLeveldataPath(installPath, 'master')
    assert.ok(fs.existsSync(luaPath))
    const overrides = parseLeveldataOverrides(fs.readFileSync(luaPath, 'utf8'))
    assert.equal(overrides.krampus, 'often')
    assert.equal(overrides.day, 'longer')
    assert.equal(overrides.branching, 'most')
  })

  it('rejects worldgen overrides after world is generated', () => {
    const installPath = makeTempInstall()
    ensureDstClusterConfig(installPath, { gamePort: 10999 })
    const instance = makeInstance(installPath)
    const saveDir = resolveShardSaveDir(installPath, 'master')
    fs.mkdirSync(saveDir, { recursive: true })
    fs.writeFileSync(path.join(saveDir, 'session'), 'x')
    assert.equal(isShardWorldGenerated(installPath, 'master'), true)
    assert.throws(
      () => saveShardConfig(instance, {
        instanceId: instance.id,
        shard: 'master',
        serverPort: 10999,
        steamAuthPort: 8766,
        steamMasterPort: 12346,
        worldgenPreset: 'SURVIVAL_TOGETHER',
        worldgenOverrides: { branching: 'most' },
      }),
      /已生成/,
    )
  })
})
