import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { buildNativeLauncherScript, buildNativeSystemdUnit } from './native-systemd-runtime'
import type { ShardContainerSpec } from './types'

function buildSpec(): ShardContainerSpec {
  return {
    instanceId: 'instance-1',
    shard: 'master',
    image: '',
    name: 'gsh-instance-1-master',
    hostInstallPath: '/srv/gsh/instance-1',
    cmd: [
      '/srv/gsh/instance-1/bin64/dontstarve_dedicated_server_nullrenderer_x64',
      '-cluster',
      'Cluster 1',
    ],
    workingDir: '/srv/gsh/instance-1/bin64',
    env: {
      LD_LIBRARY_PATH: '/srv/gsh/instance-1/bin64/lib64',
    },
  }
}

const RESOURCE_ENV_KEYS = ['GSH_DST_CONTAINER_MEMORY_MB', 'GSH_DST_CONTAINER_CPU_QUOTA'] as const
const savedEnv = new Map<string, string | undefined>()

afterEach(() => {
  for (const key of RESOURCE_ENV_KEYS) {
    const previous = savedEnv.get(key)
    if (previous === undefined) {
      delete process.env[key]
    }
    else {
      process.env[key] = previous
    }
  }
  savedEnv.clear()
})

function setResourceEnv(key: typeof RESOURCE_ENV_KEYS[number], value: string) {
  if (!savedEnv.has(key)) {
    savedEnv.set(key, process.env[key])
  }
  process.env[key] = value
}

function clearResourceEnv() {
  for (const key of RESOURCE_ENV_KEYS) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, process.env[key])
    }
    delete process.env[key]
  }
}

describe('NativeSystemdRuntime serialization', () => {
  it('quotes launcher arguments and feeds stdin from a FIFO', () => {
    const script = buildNativeLauncherScript(buildSpec(), '/srv/gsh/runtime/stdin.fifo')
    assert.match(script, /mkfifo -m 600/)
    assert.match(script, /'Cluster 1'/)
    assert.match(script, /<&3/)
  })

  it('writes a restartable user unit with journald output', () => {
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.match(unit, /Restart=on-failure/)
    assert.match(unit, /StandardOutput=journal/)
    assert.match(unit, /Environment="LD_LIBRARY_PATH=/)
    assert.match(unit, /WantedBy=default\.target/)
  })

  // 回归：客户端等待曾短于 unit 的停机预算，DST 存盘途中被判失败，remove 中断后
  // disable 未执行，宿主重启时该分片会被 systemd 自行拉起。
  it('gives the unit enough time to stop and a raised file descriptor limit', () => {
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.match(unit, /TimeoutStopSec=30/)
    assert.match(unit, /LimitNOFILE=65535/)
  })

  it('wires DST resource limits from the environment into the unit', () => {
    setResourceEnv('GSH_DST_CONTAINER_MEMORY_MB', '1536')
    setResourceEnv('GSH_DST_CONTAINER_CPU_QUOTA', '1.5')
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.match(unit, /MemoryMax=1610612736/)
    assert.match(unit, /CPUQuota=150\.00%/)
  })

  it('omits resource limits when neither variable is set', () => {
    clearResourceEnv()
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.doesNotMatch(unit, /MemoryMax=/)
    assert.doesNotMatch(unit, /CPUQuota=/)
  })
})
