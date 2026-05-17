declare module 'pidusage' {
  export interface PidUsageStats {
    cpu: number
    memory: number
    ppid: number
    pid: number
    elapsed: number
    timestamp: number
  }

  function pidusage(pid: number | number[]): Promise<PidUsageStats | Record<number, PidUsageStats>>
  export default pidusage
}
