/** 宿主机内存守卫失败时 API data 载荷 */
export interface HostMemoryPressureData {
  availableMb: number
  requiredMb: number
  totalMb: number | null
  capMb: number | null
  /** 供通知/安装日志展示的完整说明（不含标题行） */
  detail: string
}
