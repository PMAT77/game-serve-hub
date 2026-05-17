# Game Server Hub — Standalone 迁移日志

## 基线

| 项 | 值 |
|----|-----|
| 源路径 | `apps/game-server-hub`（母仓 fantastic-admin） |
| 源 commit | `64f359aba20a98b23180fa35646eb4a116954df3` |
| 复制日期 | 2026-05-17 |
| 副本路径 | `apps/game-server-hub-standalone` |

## 策略

- **业务功能**：继续在 `apps/game-server-hub` 开发，验证后 cherry-pick / 同步到本副本。
- **框架依赖**：内嵌 `packages/{components,settings,types,themes,copyright}` 与自包含 `uno.config.ts`，不依赖母仓 `packages/*` 与根 `uno.config.ts`。
- **UI**：保持 FA 布局/主题 + Naive 业务页，不替换 `Fa*`、不重构 `layouts/`。

## 后续项（非阻塞）

- [ ] `src/views/index.vue` 中 fantastic-admin Git 外链
- [ ] `scripts/install.linux.sh` 镜像 `ghcr.io/fantastic-admin/game-server-hub`
- [ ] 可选：包名由 `@fantastic-admin/game-server-hub` 改为 `game-server-hub`

## Git 分支（本副本）

- **`develop`**：日常开发、Drizzle 迁移、上游 cherry-pick；默认 push 目标。
- **`main`**：可部署基线；里程碑验证后从 `develop` 合并并打 tag。
- **`feature/*`**：可选，大改动隔离后合并回 `develop`。
- 数据库：改 schema 后 `pnpm db:generate`，同 commit 提交 `server/drizzle/`；不提交 `*.sqlite`。

## 与上游同步

见 [docs/UPSTREAM.md](./docs/UPSTREAM.md)。
