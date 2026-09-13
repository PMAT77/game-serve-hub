# 接口参考

面向二次开发与集成。面板是前后端分离应用：前端在 `src/`，后端在 `server/`，**接口契约集中在 `shared/contracts/`**，前后端共用同一份类型定义。

## 约定

- 业务接口统一挂在 `/app/...` 前缀下，例如 `GET /app/system/panel-update/status`、`POST /app/instance/shards`、`POST /app/schedule/list`。
- 类型定义按模块放在 `shared/contracts/`：`system.ts`、`instance.ts`、`cluster.ts`、`shard.ts`、`console.ts`、`mod.ts`、`backup.ts`、`schedule.ts`、`notify.ts`、`node.ts`、`auth.ts`、`maintenance.ts`、`dst-summary.ts` 等；前端 `src/api/` 直接复用这些契约，改接口时两边同步。
- 响应统一为成功 `{ code: 'OK', data }` 或失败 `{ code: <错误码>, message }`（`ApiSuccessResponse` / `ApiErrorResponse`）。
- 除登录相关接口外都需要登录态，未登录返回 `AUTH_UNAUTHORIZED`，权限不足返回 `AUTH_FORBIDDEN`。
- 路由枚举与前端路径常量见 `shared/constants/frontend-routes.ts`。

## 错误码

完整常量见 `shared/constants/error-code.ts`，常用项：

| 错误码 | 含义 | 处理方式 |
| --- | --- | --- |
| `COMMON_INVALID_PARAMS` | 参数校验失败 | 对照 `shared/contracts` 中的 schema 检查请求体 |
| `AUTH_UNAUTHORIZED` / `AUTH_FORBIDDEN` | 未登录 / 无权限 | 重新登录，或确认账号权限点 |
| `AUTH_FORCE_PASSWORD_CHANGE` | 强制改密未完成 | 跳转 `/force-change-password` 完成改密 |
| `AUTH_CAPTCHA_REQUIRED` / `AUTH_LOGIN_RATE_LIMITED` | 需要验证码 / 登录被限流 | 稍后重试 |
| `HOST_MEMORY_PRESSURE` | 宿主机可用内存不足 | 调整内存档位或先停掉其它实例，见 [内存建议](MEMORY.md) |
| `INSTANCE_PORT_CONFLICT` | 实例端口与已有实例冲突 | 手动修改端口或使用自动分配 |
| `BACKUP_NOT_FOUND` / `BACKUP_REQUIRES_STOPPED` / `BACKUP_FILE_MISSING` | 备份不存在 / 实例未停止 / 备份文件丢失 | 见 [DST 开服教程 · 备份与恢复](DST_TUTORIAL.md#17-备份与恢复) |
| `BACKUP_CREATE_FAILED` / `BACKUP_RESTORE_FAILED` | 备份或恢复执行失败 | 查看面板日志与实例状态 |
| `BACKUP_IMPORT_SOURCE_INVALID` / `BACKUP_IMPORT_UPLOAD_INVALID` | 导入的存档结构无效 / 上传包无效 | 确认存档目录结构与压缩包大小限制 |

## 新增或修改接口

1. 在 `shared/contracts/<模块>.ts` 定义请求与响应类型；
2. 在 `server/src/modules/<模块>/` 实现并注册路由（`app/<前缀>/...`），复用 `server/src/shared/http` 的响应包装与错误码；
3. 前端在 `src/api/` 增加对应封装；
4. 破坏性变更写入 [CHANGELOG.md](../CHANGELOG.md) 并在 Release Notes 标注迁移方式（参考 0.4.0 中 `effectiveHints` 的弃用写法）。

## 反向代理与客户端 IP

面板部署在 Nginx / Caddy 等反向代理后面时，必须在 `panel.env` 设置 `GSH_TRUST_PROXY`（可信代理地址），否则服务端取到的是代理地址，影响登录限流与日志中的来源 IP。字段定义见 `server/src/shared/config/index.ts`。

## 相关文档

- 表结构与迁移：[DATABASE.md](DATABASE.md)
- 分层与端口 / 适配器边界：[ARCHITECTURE.md](ARCHITECTURE.md)
- 后端目录与模块职责：[server/src/README.md](../server/src/README.md)
