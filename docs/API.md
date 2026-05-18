# GameServerHub API 说明

> 业务接口统一前缀 `/app`（除健康检查 `/health`、`/api/ping`）。  
> 类型契约逐步对齐 `shared/contracts`。  
> 最后更新：2026-05-18（模块 0 文档同步）

## 1. 通用约定

### 1.1 鉴权

- 登录后请求头携带：`token: <account>:<jwt>`（与现有实现一致）。
- SSE：`GET /app/instance/console/stream?instanceId=&token=`（query 传 token）。
- 未登录或无效 token：业务接口返回鉴权失败结构（`status: 0`）。

### 1.2 响应结构

```json
{
  "status": 1,
  "error": "",
  "code": "OK",
  "data": {},
  "requestId": "..."
}
```

- 业务失败：`status: 1`，`error` 有文案，`code` 为错误码（见 `shared/constants/error-code.ts`）。
- 鉴权失败：`status: 0`。

### 1.3 强制改密

当环境变量 `FORCE_PASSWORD_CHANGE=1` 时，除白名单外所有 `/app/*` 返回需改密提示。白名单包括：`/app/account/login`、`logout`、`permission`、`password/edit`。

### 1.4 REST 风格

- 查询列表多用 `POST` + body（与现有 instance 模块一致）。
- 规划新增资源型接口优先 REST 名词复数（如 `/app/instances/:id/clusters`），实现时可与现有风格渐进统一。

---

## 2. 认证与路由

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/route/list` | 已实现 | 动态菜单路由 |
| POST | `/app/account/login` | 已实现 | 登录 |
| POST | `/app/account/logout` | 已实现 | 登出 |
| GET | `/app/account/permission` | 已实现 | 权限与 `mustChangePassword` |
| POST | `/app/account/password/edit` | 已实现 | 修改密码 |

---

## 3. 系统

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/system/settings` | 已实现 | 面板设置 |
| POST | `/app/system/settings` | 已实现 | 保存设置 |
| GET | `/app/system/info` | 已实现 | CPU/内存/磁盘/OS/Docker |
| GET | `/app/system/network/realtime` | 已实现 | 网卡流量 |
| GET | `/app/system/network/config` | 已实现 | 网络配置读 |
| POST | `/app/system/network/config` | 已实现 | 网络配置写 |
| POST | `/app/system/network/validate` | 已实现 | 校验 |
| POST | `/app/system/network/apply` | 已实现 | 应用 |
| GET | `/app/system/filesystem/directories` | 已实现 | 目录浏览（安装路径选择） |
| GET | `/app/system/filesystem/search` | 已实现 | 目录搜索 |
| GET | `/app/system/steamcmd/config` | 已实现 | SteamCMD 配置 |
| POST | `/app/system/steamcmd/config` | 已实现 | 保存 SteamCMD |
| POST | `/app/system/steamcmd/install` | 已实现 | 触发安装 |

---

## 4. 节点

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| POST | `/app/node/local/register` | 已实现 | 本地节点注册 |
| POST | `/app/node/list` | 已实现 | 节点列表（含资源快照） |

---

## 5. 游戏实例

> **运行时（目标态）**：安装、启停、删除设计为经 `ContainerRuntime`（Docker API），`container_id` 持久化 Master 容器 ID；SteamCMD 经一次性 `steamcmd` 容器任务（`steamcmd-runner.ts`）。**模块 0 仅验收面板安装（场景 A）**；上述链路须在 Compose / panel 容器环境下回归（场景 C，模块 2）。洞穴 Shard 容器未在本期 API 暴露。

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| POST | `/app/instance/list` | 已实现 | 列表与筛选 |
| GET | `/app/instance/games` | 已实现 | 可安装游戏（v1 仅 DST） |
| GET | `/app/instance/install-log` | 已实现 | 安装日志 |
| POST | `/app/instance/create` | 已实现 | 创建实例 |
| POST | `/app/instance/start` | 已实现 | 启动 |
| POST | `/app/instance/stop` | 已实现 | 停止 |
| POST | `/app/instance/restart` | 已实现 | 重启 |
| POST | `/app/instance/delete` | 已实现 | 删除 |
| POST | `/app/instance/update` | 已实现 | 手动更新服务端 |
| POST | `/app/instance/check-updates` | 已实现 | 检查更新 |
| POST | `/app/instance/metrics` | 已实现 | 运行中 CPU/内存 |

### 5.1 规划：DST 房间（Cluster）

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/instances/:instanceId/cluster` | 规划 | 获取 cluster.ini 解析结果 |
| PUT | `/app/instances/:instanceId/cluster` | 规划 | 更新房间配置 |
| POST | `/app/instances/:instanceId/cluster/regenerate` | 规划 | 从模板重建（可选） |

### 5.2 规划：DST 世界（Shard）

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/instances/:instanceId/shards` | 规划 | Master/Caves 状态与配置 |
| PUT | `/app/instances/:instanceId/shards/:shard` | 规划 | 更新 server.ini / worldgen |
| POST | `/app/instances/:instanceId/shards/caves/enable` | 规划 | 启用洞穴并创建容器 |
| POST | `/app/instances/:instanceId/shards/caves/disable` | 规划 | 停用洞穴 |

---

## 6. 实例控制台

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/instance/console/logs` | 已实现 | 轮询日志 |
| GET | `/app/instance/console/stream` | 已实现 | SSE 日志流 |
| POST | `/app/instance/console/logs/clear` | 已实现 | 清空内存日志 |
| POST | `/app/instance/console/command` | 已实现 | 下发命令 |
| GET | `/app/instance/console/commands` | 规划 | 按 gameCode 返回快捷命令表 |
| POST | `/app/instance/console/command/preset` | 规划 | 执行预设（带确认级别） |

---

## 7. 规划：Mod

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/workshop/search` | 规划 | 搜索创意工坊 |
| GET | `/app/workshop/items/:id` | 规划 | Mod 详情 |
| GET | `/app/instances/:instanceId/mods` | 规划 | 已安装列表 |
| POST | `/app/instances/:instanceId/mods` | 规划 | 安装 |
| DELETE | `/app/instances/:instanceId/mods/:modId` | 规划 | 卸载 |
| PUT | `/app/instances/:instanceId/mods/order` | 规划 | 排序 |

---

## 8. 规划：备份

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/instances/:instanceId/backups` | 规划 | 列表 |
| POST | `/app/instances/:instanceId/backups` | 规划 | 创建备份 |
| POST | `/app/instances/:instanceId/backups/:id/restore` | 规划 | 恢复 |
| PATCH | `/app/instances/:instanceId/backups/:id` | 规划 | 备注 |
| DELETE | `/app/instances/:instanceId/backups/:id` | 规划 | 删除 |

---

## 9. 规划：配置与文件

| 方法 | 路径 | 状态 | 说明 |
|------|------|------|------|
| GET | `/app/instances/:instanceId/config` | 规划 | 配置树或分组 |
| PUT | `/app/instances/:instanceId/config` | 规划 | 保存 |
| GET | `/app/instances/:instanceId/files` | 规划 | 列目录 |
| GET | `/app/instances/:instanceId/files/content` | 规划 | 读文件 |
| PUT | `/app/instances/:instanceId/files/content` | 规划 | 写文件 |

---

## 10. 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 探活 |
| GET | `/api/ping` | 示例 |

---

## 11. 错误码（摘录）

| code | 含义 |
|------|------|
| `OK` | 成功 |
| `COMMON_INVALID_PARAMS` | 参数无效 |
| `COMMON_BUSINESS_RULE_VIOLATION` | 业务规则 |
| `AUTH_UNAUTHORIZED` | 未授权 |
| `COMMON_NOT_FOUND` | 不存在 |
| `COMMON_INTERNAL_ERROR` | 服务器错误 |

---

## 12. 维护

- 实现新接口时更新本表并补充 [FDS](FDS/README.md) §7。  
- 优先在 `shared/contracts` 增加 TypeScript 类型后由前后端引用。

---

*「已实现」指当前仓库代码；「规划」指 v1 目标，路径可在实现时微调但须更新本文档。*
