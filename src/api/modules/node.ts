import api from '../index'

export interface NodeResourceSnapshot {
  cpu: {
    cores: number
    usageRate: number
    availableRate: number
  }
  memory: {
    totalGb: number
    usedGb: number
    freeGb: number
    usageRate: number
  }
  disk: {
    totalGb: number
    usedGb: number
    freeGb: number
    usageRate: number
  }
}

export interface NodeListItem {
  id: string
  name: string
  host: string
  sshPort: number
  status: 'online' | 'offline'
  resources: NodeResourceSnapshot
  lastHeartbeatAt: string | null
  createdAt: string
  updatedAt: string
}

export default {
  getNodeList: () => api.post('app/node/list', {}),
  registerLocalNode: () => api.post('app/node/local/register'),
}
