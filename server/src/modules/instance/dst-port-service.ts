import type { DbGameInstance } from '../../shared/db/index'
import { listGameInstances } from '../../shared/db/index'
import {
  allocateDstGamePortFromReserved,
  collectReservedDstPortsFromInstances,
  type CollectReservedDstPortsOptions,
} from '../../infra/game-adapter/dst/port-allocation'

export async function collectReservedDstPortsOnNode(
  nodeId: string,
  excludeInstanceId?: string,
  options?: CollectReservedDstPortsOptions,
): Promise<Set<number>> {
  const instances = await listGameInstances({ nodeId })
  return collectReservedDstPortsFromInstances(instances, excludeInstanceId, options)
}

export async function allocateDstGamePort(
  nodeId: string,
  excludeInstanceId?: string,
): Promise<number> {
  const reserved = await collectReservedDstPortsOnNode(nodeId, excludeInstanceId)
  return allocateDstGamePortFromReserved(reserved)
}

export async function collectReservedDstPortsForInstances(
  instances: DbGameInstance[],
  excludeInstanceId?: string,
  options?: CollectReservedDstPortsOptions,
): Promise<Set<number>> {
  return collectReservedDstPortsFromInstances(instances, excludeInstanceId, options)
}
