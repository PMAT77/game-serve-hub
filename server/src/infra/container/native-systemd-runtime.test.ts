import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { buildNativeLauncherScript, buildNativeSystemdUnit, formatUnitLoadDiagnostic } from './native-systemd-runtime'
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

  // 回归：systemd 对 WorkingDirectory= 不做去引号处理，写 `"/path"` 会被判成
  // "path is not absolute" → `has a bad unit file setting`，Native 下实例一个都起不来。
  it('writes WorkingDirectory without quotes', () => {
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.match(unit, /^WorkingDirectory=\/srv\/gsh\/instance-1\/bin64$/m)
    assert.doesNotMatch(unit, /WorkingDirectory="/)
  })

  // 回归：路径里的裸 % 会被 systemd 当成 specifier 展开，整个 unit 被判非法，
  // systemctl 只回一句 "has a bad unit file setting"，现场无法定位。
  it('escapes percent signs in the values systemd expands', () => {
    const spec = buildSpec()
    spec.workingDir = '/srv/gsh/room%1/bin64'
    spec.cmd = ['/srv/gsh/room%1/bin64/dontstarve_dedicated_server_nullrenderer_x64', '-cluster', 'Cluster_1']
    const unit = buildNativeSystemdUnit(spec, '/srv/gsh/room%1/launch.sh')
    assert.match(unit, /^WorkingDirectory=\/srv\/gsh\/room%%1\/bin64$/m)
    assert.match(unit, /ExecStart="\/srv\/gsh\/room%%1\/launch\.sh"/)
    assert.doesNotMatch(unit, /room%1/)
  })

  it('clamps out-of-range resource limits instead of writing an invalid unit', () => {
    setResourceEnv('GSH_DST_CONTAINER_MEMORY_MB', '1536')
    setResourceEnv('GSH_DST_CONTAINER_CPU_QUOTA', '200')
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.match(unit, /MemoryMax=1610612736/)
    assert.match(unit, /CPUQuota=10000\.00%/)
  })

  it('does not wait on network-online.target, which no user instance provides', () => {
    const unit = buildNativeSystemdUnit(buildSpec(), '/srv/gsh/runtime/launch.sh')
    assert.doesNotMatch(unit, /network-online\.target/)
  })

  it('collects the evidence systemd hides behind a bad unit file setting', () => {
    const diagnostic = formatUnitLoadDiagnostic({
      unitPath: '/srv/gsh/unit.service',
      unitContent: '[Service]\nWorkingDirectory="x"\n',
      verifyOutput: '/srv/gsh/unit.service:2: Invalid setting\n',
      statusOutput: 'Loaded: bad-setting\n',
    })
    assert.match(diagnostic, /systemd-analyze verify：/)
    assert.match(diagnostic, /Invalid setting/)
    assert.match(diagnostic, /unit 文件内容（\/srv\/gsh\/unit\.service）/)
  })

  it('truncates oversized diagnostics', () => {
    const diagnostic = formatUnitLoadDiagnostic({
      unitPath: '/srv/gsh/unit.service',
      unitContent: 'x'.repeat(5000),
    })
    assert.match(diagnostic, /已截断/)
  })
})
