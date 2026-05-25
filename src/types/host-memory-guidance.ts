/** 与 shared/contracts/host-memory-guidance 及 /app/system/info 响应对齐 */

export type HostMemoryTier = 'small' | 'medium' | 'large'

export interface HostMemoryTierScenario {
  singleInstance: string
  caves: string
  mods: string
  multiInstance: string
}

export interface HostMemoryGuidancePayload {
  tier: HostMemoryTier
  tierLabelZh: string
  presetName: HostMemoryTier
  totalMb: number | null
  availableMb: number | null
  summaryZh: string
  scenarios: HostMemoryTierScenario
  cavesWarning: string | null
  modsWarning: string | null
  installWarning: string | null
}
