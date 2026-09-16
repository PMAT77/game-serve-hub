import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, describe, it } from 'node:test'
import { resolveDockerStatus } from '../../infra/docker.ts'
import {
  bumpCavesStartGeneration,
  classifyMasterProbe,
  ensureContainerRuntimeReady,
  isCurrentCavesStartGeneration,
  isHealthyRuntimeForResurrect,
  readClusterMasterPort,
  resolveShardReadyWaitSec,
} from './container-lifecycle.ts'

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsh-lifecycle-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('ensureContainerRuntimeReady', () => {
  it('returns ok=false with message when Docker is stopped', async () => {
    if ((await resolveDockerStatus()) === 'running') {
      return
    }
    const result = await ensureContainerRuntimeReady()
    assert.equal(result.ok, false)
    assert.match(result.message ?? '', /Docker/)
  })

  it('returns structured readiness result', async () => {
    const result = await ensureContainerRuntimeReady()
    assert.equal(typeof result.ok, 'boolean')
    if (!result.ok) {
      assert.ok(result.message && result.message.length > 0)
    }
  })
})

/**
 * 回归：systemd `Restart=on-failure` + `RestartSec=5` 期间单元是 activating/auto-restart。
 * 状态对账的第二趟若把它当成「容器还在跑」而翻回运行中，就会抹掉上一趟刚写入的崩溃告警
 * ——线上实测同一个请求里两趟互相覆盖，「主世界已停止但洞穴仍在运行」写入一秒后就消失，
 * 服主永远看不到。
 */
describe('isHealthyRuntimeForResurrect', () => {
  it('拒绝把自动拉起窗口里的分片当成健康运行', () => {
    assert.equal(isHealthyRuntimeForResurrect({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: true,
      restarting: true,
      exitResult: 'oom-kill',
    }), false)
  })

  it('拒绝把已经重启过的分片重新标成运行中', () => {
    assert.equal(isHealthyRuntimeForResurrect({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: true,
      restarts: 2,
    }), false)
  })

  it('接受真正在跑且没重启过的分片', () => {
    assert.equal(isHealthyRuntimeForResurrect({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: true,
    }), true)
  })

  it('探测不到运行时时不复活实例', () => {
    assert.equal(isHealthyRuntimeForResurrect(null), false)
    assert.equal(isHealthyRuntimeForResurrect({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: false,
      probeFailed: true,
    }), false)
  })
})

/**
 * 等待主世界就绪期间的判决。
 *
 * 关键回归：`Restart=on-failure` 的重启窗口里单元仍算「在运行」。若只看 running，
 * 主世界崩溃循环时会被判成「还活着」，白等满 300 秒上限后照样把洞穴拉起来占内存
 * ——这正是线上「洞穴单独在跑、主世界反复重启」的成因。
 */
describe('classifyMasterProbe', () => {
  it('把重启窗口里的主世界判成崩溃循环而不是还活着', () => {
    assert.equal(classifyMasterProbe({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: true,
      restarting: true,
    }), 'restart-loop')
  })

  it('把已经重启过的主世界判成崩溃循环', () => {
    assert.equal(classifyMasterProbe({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: true,
      restarts: 2,
      exitResult: 'oom-kill',
    }), 'restart-loop')
  })

  it('把真正在跑的主世界判成健康', () => {
    assert.equal(classifyMasterProbe({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: true,
    }), 'healthy')
  })

  it('把已停止的主世界判成退出', () => {
    assert.equal(classifyMasterProbe({
      id: 'gsh-x-master.service',
      name: 'gsh-x-master',
      running: false,
      exitResult: 'oom-kill',
    }), 'stopped')
  })

  it('问不到运行时只算未知，不能误判成崩溃', () => {
    assert.equal(classifyMasterProbe(null), 'unknown')
  })
})

/**
 * 后台等主世界就绪可能好几分钟，这期间用户完全可能又点了一次停止或重新启动。
 * 旧任务若不作废，就会在实例已经停机之后把洞穴拉起来，并挂上一个再也停不掉的日志跟随。
 */
describe('洞穴启动代号', () => {
  it('停止或重新启动会让等待中的任务作废', () => {
    const instanceId = 'instance-gen-1'
    const first = bumpCavesStartGeneration(instanceId)
    assert.equal(isCurrentCavesStartGeneration(instanceId, first), true)
    const second = bumpCavesStartGeneration(instanceId)
    assert.equal(isCurrentCavesStartGeneration(instanceId, first), false)
    assert.equal(isCurrentCavesStartGeneration(instanceId, second), true)
  })

  it('从未启动过的实例没有任何代号算当前', () => {
    assert.equal(isCurrentCavesStartGeneration('instance-gen-never-started', 1), false)
    assert.equal(isCurrentCavesStartGeneration('instance-gen-never-started', 0), true)
  })
})

describe('resolveShardReadyWaitSec', () => {  const original = process.env.GSH_SHARD_READY_WAIT_SEC
  afterEach(() => {
    if (original === undefined) {
      delete process.env.GSH_SHARD_READY_WAIT_SEC
    }
    else {
      process.env.GSH_SHARD_READY_WAIT_SEC = original
    }
  })

  /**
   * 上限必须给足：36 个 Mod 的分片在 2 核机上冷启动要两分多钟。
   * 等不够就放洞穴进来，两个加载峰值会重新叠在一起——正是被 OOM 杀掉的那次。
   */
  it('默认上限足以覆盖多 Mod 分片的冷启动', () => {
    delete process.env.GSH_SHARD_READY_WAIT_SEC
    assert.ok(resolveShardReadyWaitSec() >= 600)
  })

  it('允许用环境变量覆盖', () => {
    process.env.GSH_SHARD_READY_WAIT_SEC = '1200'
    assert.equal(resolveShardReadyWaitSec(), 1200)
  })

  it('非法值退回默认上限', () => {
    process.env.GSH_SHARD_READY_WAIT_SEC = 'abc'
    assert.ok(resolveShardReadyWaitSec() >= 600)
    process.env.GSH_SHARD_READY_WAIT_SEC = '-5'
    assert.ok(resolveShardReadyWaitSec() >= 600)
  })
})

describe('readClusterMasterPort', () => {  it('读取 cluster.ini 的 master_port', () => {
    const installPath = createTempDir()
    const shardRoot = path.join(installPath, 'klei-storage', 'DoNotStarveTogether', 'Cluster_1')
    fs.mkdirSync(shardRoot, { recursive: true })
    fs.writeFileSync(
      path.join(shardRoot, 'cluster.ini'),
      ['[SHARD]', 'shard_enabled = true', 'master_port = 12000', ''].join('\n'),
    )
    assert.equal(readClusterMasterPort(installPath), 12000)
  })

  it('配置文件缺失时退回 DST 默认端口', () => {
    assert.equal(readClusterMasterPort(createTempDir()), 10888)
  })
})
