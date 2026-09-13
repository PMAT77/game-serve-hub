# modules 目录说明

后端业务模块目录。每个模块对外只暴露注册入口（路由挂在 `app/...` 前缀下），模块内部按 `controller -> service/usecase -> domain -> repository` 分层。

## 当前模块

| 模块 | 职责 |
| --- | --- |
| `auth` | 认证、登录态、权限点与密码管理 |
| `instance` | 实例生命周期、安装与更新检查、端口同步、异常退出处理 |
| `cluster` | 集群与房间配置（`cluster.ini`） |
| `shard` | 分片配置（地上 / 洞穴） |
| `console` | 控制台日志流、命令下发与维护公告 |
| `mod` | 创意工坊 Mod 下载、文件落位与同步 |
| `backup` | 实例存档备份与恢复、外部存档导入、数据库快照 |
| `schedule` | 计划任务（定时备份 / 重启 / 更新检查 / 数据库快照） |
| `notify` | 通知渠道（Webhook / Telegram）与阈值检查 |
| `node` | 节点信息探测与节点控制 |
| `system` | 系统设置、面板更新、面板端口与健康检查 |

新增模块时同步更新本表；模块划分与边界变更请同时更新 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)。

## 组织建议

- 每个模块独立目录，避免跨模块直接访问内部实现。
- 模块内建议分层：`controller -> service/usecase -> domain -> repository`。
- 模块对外仅暴露 `index.ts` 注册入口（路由、依赖注入）。
- 需要访问 Docker、systemd、SteamCMD 等外部系统时，走 `../infra/` 的适配器，不在模块内直接调用。
