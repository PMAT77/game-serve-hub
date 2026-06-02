import type { RouteLocationRaw } from 'vue-router'
import { FRONTEND_ROUTE_PATHS } from '../../shared/constants/frontend-routes'

/** 与后端 menu-routes、auth 动态路由 name 保持一致 */
export const ROUTE_NAMES = {
  nodeInstance: 'nodeInstance',
  nodeInstanceConsole: 'nodeInstanceConsole',
  dstRoomList: 'dstRoomList',
  dstRoomSettings: 'dstRoomSettings',
  dstWorldList: 'dstWorldList',
  dstWorldSettings: 'dstWorldSettings',
  dstModList: 'dstModList',
  dstModDetail: 'dstModDetail',
} as const

export { FRONTEND_ROUTE_PATHS }

export function routeToNodeInstance(): RouteLocationRaw {
  return { name: ROUTE_NAMES.nodeInstance }
}

export function routeToInstanceConsole(instanceId: string): RouteLocationRaw {
  return { name: ROUTE_NAMES.nodeInstanceConsole, params: { instanceId } }
}

export function routeToDstRoomList(): RouteLocationRaw {
  return { name: ROUTE_NAMES.dstRoomList }
}

export function routeToDstRoomSettings(instanceId: string): RouteLocationRaw {
  return { name: ROUTE_NAMES.dstRoomSettings, params: { instanceId } }
}

export function routeToDstWorldList(): RouteLocationRaw {
  return { name: ROUTE_NAMES.dstWorldList }
}

export function routeToDstWorldSettings(
  instanceId: string,
  query?: Record<string, string>,
): RouteLocationRaw {
  return { name: ROUTE_NAMES.dstWorldSettings, params: { instanceId }, query }
}

export function routeToDstModList(): RouteLocationRaw {
  return { name: ROUTE_NAMES.dstModList }
}

export function routeToDstModDetail(workshopId: string, instanceId: string): RouteLocationRaw {
  return {
    name: ROUTE_NAMES.dstModDetail,
    params: { workshopId },
    query: { instanceId },
  }
}
