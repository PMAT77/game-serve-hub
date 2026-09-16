import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { resolveDockerStatus } from '../../infra/docker.ts'
import {
  ensureContainerRuntimeReady,
  isHealthyRuntimeForResurrect,
  readClusterMasterPort,
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

describe('readClusterMasterPort', () => {
  it('读取 cluster.ini 的 master_port', () => {
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
