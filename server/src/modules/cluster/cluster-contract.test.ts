import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clusterInstanceQuerySchema,
  clusterSavePayloadSchema,
} from '../../../../shared/contracts/cluster'

const validPayload = {
  instanceId: 'instance-1',
  networkMode: 'offline',
  clusterName: 'DST Server',
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
  shardEnabled: false,
  bindIp: '127.0.0.1',
  masterIp: '127.0.0.1',
  masterPort: 10888,
  clusterKey: 'supersecretkey',
  steamGroupOnly: false,
  steamGroupId: '0',
  steamGroupAdmins: false,
}

describe('cluster API contracts', () => {
  it('normalizes the instance id query', () => {
    assert.deepEqual(clusterInstanceQuerySchema.parse({
      instanceId: ' instance-1 ',
    }), {
      instanceId: 'instance-1',
    })
  })

  it('accepts a complete room configuration payload', () => {
    assert.deepEqual(clusterSavePayloadSchema.parse({
      ...validPayload,
      clusterName: ' DST Server ',
      restart: true,
    }), {
      ...validPayload,
      clusterName: 'DST Server',
      restart: true,
    })
  })

  it('rejects invalid room configuration values', () => {
    assert.equal(clusterSavePayloadSchema.safeParse({
      ...validPayload,
      maxPlayers: 65,
    }).success, false)
    assert.equal(clusterSavePayloadSchema.safeParse({
      ...validPayload,
      steamGroupId: 'not-a-group-id',
    }).success, false)
  })
})
