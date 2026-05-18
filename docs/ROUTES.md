# 路由、菜单与权限

> 前端路由模式：hash 或 history（见框架 `settings.app.routeMode`）。  
> 菜单数据：`GET /app/route/list`（生产）或 mock `src/api/modules/app.fake.ts`（开发）。  
> 最后更新：2026-05-18

## 1. 固定路由（无需登录或特殊）

| 路径 | 名称 | 组件 |
|------|------|------|
| `/login` | login | `views/login.vue` |
| `/account/force-change-password` | forceChangePassword | `views/force-change-password.vue` |
| `/:all(.*)*` | notFound | `views/[...all].vue` |

## 2. 当前已上线菜单（动态路由）

| 菜单 | 路径 | 路由 name | 组件 | 权限 |
|------|------|-----------|------|------|
| 监控台 | `/console/monitor` | consoleMonitor | `console/monitor/index.vue` | — |
| 实例管理 | `/node/instance` | nodeInstance | `node/instance/index.vue` | `pages.node.instance:manage` |
| 实例控制台 | `/node/instance/console/:instanceId` | nodeInstanceConsole | `node/instance/console.vue` | 同上；`menu: false` |
| 系统设置 | `/system/settings` | systemSettings | `system/settings.vue` | — |

## 3. v1 规划菜单

| 菜单 | 路径（规划） | 说明 |
|------|-------------|------|
| 游戏 | `/games` | DST 卡片，跳转创建实例 |
| 房间管理 | `/dst/:instanceId/cluster` 或实例 Tab | [FDS-03](FDS/03-dst-cluster.md) |
| 世界管理 | `/dst/:instanceId/shards` | [FDS-04](FDS/04-dst-shard.md) |
| Mod 管理 | `/dst/:instanceId/mods` | [FDS-05](FDS/05-mod.md) |
| 备份管理 | `/ops/backups` 或按实例 | [FDS-06](FDS/06-backup.md) |
| 文件管理 | `/ops/files/:instanceId` | [FDS-08](FDS/08-file.md) |

**导航建议**：饥荒相关子页以 `activeMenu: '/node/instance'` 保持实例列表高亮；`instanceId` 通过路由 params 或 query 传递。

## 4. 权限码

| 权限 | 用途 |
|------|------|
| `pages.node.instance:manage` | 实例 CRUD、控制台、DST 子功能（规划合并） |
| `pages.general:browse` | 框架示例（可保留） |

v1 仍为单管理员，权限主要为未来 RBAC 预留。

## 5. 与 API 的对应

| 页面 | 主要 API |
|------|---------|
| 监控台 | `/app/system/info`、`/app/system/network/realtime` |
| 实例管理 | `/app/instance/*`、`/app/node/list` |
| 实例控制台 | `/app/instance/console/*` |
| 系统设置 | `/app/system/settings` |

完整列表见 [API.md](API.md)。

## 6. 新增路由检查清单

- [ ] 更新 `app.fake.ts` 与后端 `route/list` 数据源  
- [ ] 设置 `meta.title`、`icon`、`auth`  
- [ ] 隐藏页设置 `menu: false` + `activeMenu`  
- [ ] 更新本文档与 [FDS](FDS/README.md) §5  

---

*实现路由时以 `fa-route-generator` 技能与项目既有约定为准。*
