import fs from 'node:fs'
import path from 'node:path'
import { DST_CLUSTER_NAME, DST_CONF_DIR, DST_STORAGE_DIR } from './constants'
import { writeFileAtomic } from './atomic-write'

export interface PanelConfigMeta {
  roomSavedAt?: string
  masterWorldSavedAt?: string
}

function resolveMetaPath(installPath: string): string {
  const clusterRoot = path.join(installPath, DST_STORAGE_DIR, DST_CONF_DIR, DST_CLUSTER_NAME)
  return path.join(clusterRoot, '.gsh-panel-config.json')
}

export function readPanelConfigMeta(installPath: string): PanelConfigMeta {
  const metaPath = resolveMetaPath(installPath)
  if (!fs.existsSync(metaPath)) {
    return {}
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as PanelConfigMeta
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  }
  catch {
    return {}
  }
}

function writePanelConfigMeta(installPath: string, patch: Partial<PanelConfigMeta>): void {
  const metaPath = resolveMetaPath(installPath)
  const next: PanelConfigMeta = {
    ...readPanelConfigMeta(installPath),
    ...patch,
  }
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  writeFileAtomic(metaPath, `${JSON.stringify(next, null, 2)}\n`)
}

export function markPanelRoomSaved(installPath: string): void {
  writePanelConfigMeta(installPath, { roomSavedAt: new Date().toISOString() })
}

export function markPanelMasterWorldSaved(installPath: string): void {
  writePanelConfigMeta(installPath, { masterWorldSavedAt: new Date().toISOString() })
}

export function isPanelRoomSaved(meta: PanelConfigMeta): boolean {
  return Boolean(meta.roomSavedAt)
}

export function isPanelMasterWorldSaved(meta: PanelConfigMeta): boolean {
  return Boolean(meta.masterWorldSavedAt)
}
