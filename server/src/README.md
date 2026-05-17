# Server 目录说明

Node.js 后端代码放在该目录。

## 环境变量

后端独立使用 `server/.env.*`（如 `server/.env.development`）读取配置，启动时由 `zod` 统一校验。当前支持：

- `SERVER_HOST`
- `SERVER_PORT`
- `DB_PATH`
- `SERVER_LOG_DIR`
- `LOG_LEVEL`

## 顶层结构

- `modules/`：业务模块（`auth`、`node`、`instance`、`console`、`mod`、`config`、`backup`、`file`）
- `shared/`：后端跨模块共享能力
- `infra/`：外部系统适配层
- `../drizzle/`：Drizzle 迁移文件（由 `drizzle-kit generate` 生成）

## 数据库迁移

在 `apps/game-server-hub` 目录下执行：

- `pnpm run db:generate`：基于 `server/src/shared/db/schema/index.ts` 生成迁移
- `pnpm run db:migrate`：执行迁移
- `pnpm run db:studio`：打开 Drizzle Studio

## 本地开发启动

- `pnpm run dev:prepare`：初始化数据库目录与日志目录，并打印当前加载的环境文件。
- `pnpm run dev`：一键启动前端 + 后端（包含 `dev:prepare` 预处理）。

## Linux 依赖一键安装（Ubuntu/Debian）

在 `apps/game-server-hub` 目录下执行：

- `chmod +x ./scripts/install.linux.sh`
- `./scripts/install.linux.sh`

或直接执行：

- `pnpm run install:linux`

脚本会自动安装/检查：

- Docker（`docker-ce`、`docker-compose-plugin`）
- Node.js（满足项目要求：`>=20`，默认安装 Node 22 LTS）
- SteamCMD（优先 apt，失败时回退官方 tarball）
- 主机预检（系统版本、CPU 架构、磁盘剩余空间、网络连通性）
- 端口占用检测与防火墙放行（默认 `80`）
- 拉取并启动面板镜像（默认 `ghcr.io/fantastic-admin/game-server-hub:latest`）
- 自动生成管理员账号与随机密码（首次登录强制改密）
- 安装状态日志与失败回滚（状态文件默认在 `/var/log/game-server-hub/install.status`）

可选环境变量（执行脚本前设置）：

- `PANEL_PORT`：面板端口（默认 `80`）
- `PANEL_IMAGE_REPOSITORY` / `PANEL_IMAGE_TAG`：镜像仓库与 tag
- `PANEL_HOST`：安装完成后展示的访问域名/IP（默认自动探测）
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：初始化管理员凭证（未提供时自动生成随机密码）

## 分层约定

每个模块内部建议保持清晰调用链：

`controller -> service/usecase -> domain -> repository/infra adapter`

避免跨模块深层引用；公共能力统一沉淀到 `server/src/shared/*`。
