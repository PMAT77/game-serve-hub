/** 后端菜单 activeMenu 与前端跳转共用的路径（不含 origin） */
export const FRONTEND_ROUTE_PATHS = {
  consoleMonitor: '/console/monitor',
  nodeInstance: '/node/instance',
  dstRooms: '/games/dst/rooms',
  dstWorlds: '/games/dst/worlds',
  dstMods: '/games/dst/mods',
  dstModDetail: '/games/dst/mods/:workshopId/detail',
  opsBackups: '/ops/backups',
  opsSchedules: '/ops-schedule/schedules',
  systemNotify: '/system/notify',
} as const
