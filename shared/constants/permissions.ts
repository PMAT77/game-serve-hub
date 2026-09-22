/**
 * 权限点常量（前后端共用）。
 *
 * 为什么单独抽出来：菜单定义在服务端（`server/src/shared/menu-routes.ts`），
 * 而前端也要按同一套权限点判断「这个入口能不能点」。此前常量定义在服务端模块里，
 * 前端无法 import，只能硬编码字符串——一旦改名，服务端拒绝了、前端还在放行（或反之），
 * 表现为"点进去全是报错"。放在 `shared/constants/` 下两边都能用同一份定义。
 */

/** 实例、房间、世界、玩家、Mod 等游戏侧页面的管理权限 */
export const NODE_INSTANCE_MANAGE_PERMISSION = 'pages.node.instance:manage'
/** 系统设置的只读权限（查看设置、授权状态、插件列表、审计记录） */
export const SYSTEM_READ_PERMISSION = 'system:read'
/** 系统设置的管理权限（改设置、启停插件） */
export const SYSTEM_MANAGE_PERMISSION = 'system:manage'
/** 备份与计划任务的只读权限 */
export const OPS_READ_PERMISSION = 'ops:read'
/** 备份与计划任务的管理权限 */
export const OPS_MANAGE_PERMISSION = 'ops:manage'
