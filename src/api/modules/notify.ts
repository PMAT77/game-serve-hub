import type {
  NotifyChannelCreateRequest,
  NotifyChannelIdRequest,
  NotifyChannelItem,
  NotifyChannelType,
  NotifyChannelUpdateRequest,
  NotifyMutationResult,
  NotifySettings,
  NotifyTestResult,
} from '../../../shared/contracts/notify'
import api from '../index'

export type {
  NotifyChannelCreateRequest,
  NotifyChannelIdRequest,
  NotifyChannelItem,
  NotifyChannelType,
  NotifyChannelUpdateRequest,
  NotifyMutationResult,
  NotifySettings,
  NotifyTestResult,
}

export default {
  getChannelList: () => api.post('app/notify/channel/list', {}) as Promise<{ data: NotifyChannelItem[] }>,
  createChannel: (data: NotifyChannelCreateRequest) => api.post('app/notify/channel/create', data) as Promise<{ data: NotifyMutationResult }>,
  updateChannel: (data: NotifyChannelUpdateRequest) => api.post('app/notify/channel/update', data) as Promise<{ data: NotifyMutationResult }>,
  deleteChannel: (data: NotifyChannelIdRequest) => api.post('app/notify/channel/delete', data) as Promise<{ data: NotifyMutationResult }>,
  testChannel: (data: NotifyChannelIdRequest) => api.post('app/notify/channel/test', data) as Promise<{ data: NotifyTestResult }>,
  getSettings: () => api.post('app/notify/settings/get', {}) as Promise<{ data: NotifySettings }>,
  saveSettings: (data: NotifySettings) => api.post('app/notify/settings/save', data) as Promise<{ data: NotifySettings }>,
}
