import type {
  InstanceFileContentDto,
  InstanceFileDeleteResult,
  InstanceFileEntry,
  InstanceFileListDto,
  InstanceFileRenameResult,
  InstanceFileWriteResult,
  InstanceKeyFile,
  InstanceKeyFileListDto,
} from '../../../shared/contracts/instance-file'
import api from '../index'

export type {
  InstanceFileContentDto,
  InstanceFileDeleteResult,
  InstanceFileEntry,
  InstanceFileListDto,
  InstanceFileRenameResult,
  InstanceFileWriteResult,
  InstanceKeyFile,
  InstanceKeyFileListDto,
}

export { isEditableInstanceFilePath } from '../../../shared/contracts/instance-file'

export default {
  listFiles: (instanceId: string, path = '') => api.get('app/instance/files', {
    params: { instanceId, path },
  }) as Promise<{ data: InstanceFileListDto }>,
  listKeyFiles: (instanceId: string) => api.get('app/instance/files/key-files', {
    params: { instanceId },
  }) as Promise<{ data: InstanceKeyFileListDto }>,
  readFile: (instanceId: string, path: string) => api.get('app/instance/files/content', {
    params: { instanceId, path },
  }) as Promise<{ data: InstanceFileContentDto }>,
  writeFile: (payload: { instanceId: string, path: string, content: string }) => api.put('app/instance/files/content', payload) as Promise<{ data: InstanceFileWriteResult }>,
  deletePath: (payload: { instanceId: string, path: string }) => api.post('app/instance/files/delete', payload) as Promise<{ data: InstanceFileDeleteResult }>,
  renamePath: (payload: { instanceId: string, path: string, newName: string }) => api.post('app/instance/files/rename', payload) as Promise<{ data: InstanceFileRenameResult }>,
}
