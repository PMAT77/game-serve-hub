import fs from 'node:fs'
import { DST_APP_ID } from '../../infra/game-adapter/dst/constants'
import { resolveInstanceInstallPath } from '../../infra/game-adapter/dst/cluster-service'
import { writeInstanceModFiles } from '../../infra/game-adapter/dst/mod-service'
import { LOCAL_NODE_ID } from '../../shared/dst/local-dst-instance'
import { listGameInstances, listReadyInstanceMods } from '../../shared/db/index'

type ListReadyInstanceModsFn = typeof listReadyInstanceMods

let listReadyInstanceModsFn: ListReadyInstanceModsFn = listReadyInstanceMods

export function setModFileSyncDbHooksForTest(hooks: {
  listReadyInstanceMods?: ListReadyInstanceModsFn
}) {
  if (hooks.listReadyInstanceMods) {
    listReadyInstanceModsFn = hooks.listReadyInstanceMods
  }
}

export function resetModFileSyncDbHooksForTest() {
  listReadyInstanceModsFn = listReadyInstanceMods
}

/** 将 DB 中已就绪的 Mod 写回实例安装目录（Lua / setup 文件） */
export async function syncInstanceModFilesFromDb(instanceId: string, installPath: string) {
  if (!installPath || !fs.existsSync(installPath)) {
    return
  }
  const mods = await listReadyInstanceModsFn(instanceId)
  writeInstanceModFiles(installPath, mods.map(mod => ({
    workshopId: mod.workshopId,
    enabled: mod.enabled,
    loadOrder: mod.loadOrder,
  })))
}

/** 迁移或面板启动后：同步所有本地 DST 实例的 Mod 配置 */
export async function syncAllLocalDstInstanceModFilesFromDb() {
  const instances = await listGameInstances({ nodeId: LOCAL_NODE_ID })
  for (const instance of instances) {
    if (instance.gameCode !== DST_APP_ID) {
      continue
    }
    const installPath = resolveInstanceInstallPath(instance)
    await syncInstanceModFilesFromDb(instance.id, installPath)
  }
}
