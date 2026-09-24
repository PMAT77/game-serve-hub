# 数据库

面板使用 SQLite（Node 内置 `node:sqlite`），通过 Drizzle ORM 访问。

## 位置

| 运行方式 | 数据库文件 |
| --- | --- |
| Docker | 容器内 `/app/data/game-server-hub.sqlite` |
| Native | `/var/lib/game-server-hub/game-server-hub.sqlite` |

路径由后端环境变量 `DB_PATH` 决定（见 [server/src/README.md](../server/src/README.md)）。

## 表结构

schema 定义在 `server/src/shared/db/schema/`，统一从 `index.ts` 导出：

| 文件 | 内容 |
| --- | --- |
| `auth.ts` | 用户与权限点 |
| `instance.ts` | 游戏实例 |
| `node.ts` | 节点信息 |
| `player.ts` | 玩家档案（Klei 用户 ID ↔ 游戏名、手工备注） |
| `schedule.ts` | 计划任务 |
| `notify.ts` | 通知渠道与事件 |
| `system.ts` | 面板设置与系统状态 |

## 迁移流程

```bash
pnpm run db:generate   # 依据 schema 生成迁移文件，输出到 server/drizzle/
pnpm run db:migrate    # 手动应用迁移
pnpm run db:studio     # 打开 Drizzle Studio 查看数据
```

- 改动 schema 后，**同一次提交里必须包含 `server/drizzle/` 下的迁移文件**；CI 会执行 schema 漂移检查，漏提交会让 PR 变红。
- 运行时数据库连接初始化时会自动应用尚未执行的迁移（见 `server/src/shared/db/connection.ts`），因此生产升级不需要手工执行 `db:migrate`。
- 开发环境首次拉起时，SQLite 文件与迁移由后端启动过程创建并应用（`initDatabase()`）；`pnpm run dev:prepare` 只创建数据目录与日志目录，不建库。

## 备份、快照与回滚

- 面板「备份与恢复」页的**面板数据库快照**用 SQLite `VACUUM INTO` 生成一致性副本，覆盖实例、账号与面板设置（不含游戏存档）。列表里可下载、删除、导入外部快照，也可在面板内**恢复**：服务端先留两道退路（当前库的快照 + 替换下来的旧库改名保留），再替换文件并让面板进程退出，由部署侧拉起（Docker 的 `restart: unless-stopped` / Native systemd 的 `Restart=on-failure`，因此退出码必须非零）。启动时会校验恢复后的库，不通过则自动回退到恢复前的数据。开发环境跑的是 `tsx watch`，恢复后需要手动重启面板。
- 每次面板升级前，安装器会自动备份数据库。
- **跨版本回滚前先做一次快照**：旧版本可能不认识新版本迁移过的表结构。
- Docker 与 Native 之间不自动迁移数据库，切换模式需按目标模式重装后手工搬运数据目录。

## 相关文档

- 接口与错误码：[API.md](API.md)
- 分层与模块职责：[ARCHITECTURE.md](ARCHITECTURE.md)
