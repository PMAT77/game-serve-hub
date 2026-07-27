import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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
})
