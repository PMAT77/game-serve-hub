import type { NodeListItem, NodeResourceSnapshot } from '../../../shared/contracts/node'
import api from '../index'

export type { NodeListItem, NodeResourceSnapshot }

export default {
  getNodeList: () => api.post('app/node/list', {}) as Promise<{ data: NodeListItem[] }>,
  registerLocalNode: () => api.post('app/node/local/register') as Promise<{ data: NodeListItem }>,
}
