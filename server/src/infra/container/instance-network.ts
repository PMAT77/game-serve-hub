export function buildInstanceShardNetworkName(instanceId: string): string {
  const safeId = instanceId.replace(/[^a-zA-Z0-9_.-]/g, '-')
  return `gsh-net-${safeId}`
}
