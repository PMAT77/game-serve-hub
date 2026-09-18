import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  instanceFileContentSchema,
  instanceFileEntrySchema,
  instanceFileListSchema,
  isEditableInstanceFilePath,
} from '../../../../shared/contracts/instance-file'

/**
 * files 模块的契约。
 *
 * 其中截断标记这条是有来历的：`prd.md` 只写了「1 MiB 上限」，容易被读成
 * 「超限内容照原样返回」或「直接报错」。实际上读侧只返回前 1 MiB 并带上
 * `truncated` 标记，界面据此提示「直接保存会截断文件」，这里把该口径固定下来。
 */

describe('files API contract', () => {
  it('文本文件内容带截断标记，供界面提示只显示前 1 MiB', () => {
    const result = instanceFileContentSchema.safeParse({
      instanceId: 'inst-1',
      path: 'Master/server.ini',
      content: '[NETWORK]\nserver_port = 10999\n',
      sizeBytes: 2 * 1024 * 1024,
      truncated: true,
      modifiedAt: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(result.success, true)
    assert.equal(result.success && result.data.truncated, true)
  })

  it('目录条目区分文件与目录，并标出敏感文件', () => {
    const result = instanceFileListSchema.safeParse({
      instanceId: 'inst-1',
      path: '',
      entries: [
        { path: 'cluster_token.txt', name: 'cluster_token.txt', type: 'file', sizeBytes: 64, modifiedAt: '2026-01-01T00:00:00.000Z', protected: true },
        { path: 'Master', name: 'Master', type: 'directory', sizeBytes: 0, modifiedAt: '2026-01-01T00:00:00.000Z', protected: false },
      ],
    })
    assert.equal(result.success, true)
    assert.equal(result.success && result.data.entries[0]?.protected, true)
  })

  it('可编辑类型清单按扩展名判定，覆盖 DST 常用配置文件', () => {
    for (const file of ['cluster.ini', 'server.ini', 'worldgenoverride.lua', 'modoverrides.lua', 'leveldataoverride.lua']) {
      assert.equal(isEditableInstanceFilePath(file), true, `${file} 应当可在面板内编辑`)
    }
    assert.equal(isEditableInstanceFilePath('dontstarve_dedicated_server_nullrenderer'), false)
    assert.equal(isEditableInstanceFilePath('saveindex'), false)
  })

  it('单文件条目字段完整（列表接口逐条返回）', () => {
    const result = instanceFileEntrySchema.safeParse({
      path: 'Caves/server.ini',
      name: 'server.ini',
      type: 'file',
      sizeBytes: 128,
      modifiedAt: '',
      protected: false,
    })
    assert.equal(result.success, true, 'modifiedAt 读不到时允许空串')
  })
})
