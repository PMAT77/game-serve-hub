# 贡献指南

感谢关注 GameServerHub。本文说明如何参与开发与文档维护。

## 1. 开始前阅读

**新模块或让 AI 实现功能前**，请先走一遍 **[新模块开工指南](MODULE-KICKOFF.md)**（读什么、注意什么、如何 @ 文档）。

| 顺序 | 文档 |
|------|------|
| 1 | [MODULE-KICKOFF.md](MODULE-KICKOFF.md) **（开工清单与 Agent 模板）** |
| 2 | [README.md](README.md) 文档索引 |
| 3 | [PRD.md](PRD.md) 产品范围 |
| 4 | [TODO.md](TODO.md) 当前里程碑与任务 |
| 5 | [PROJECT_BASELINE.md](PROJECT_BASELINE.md) 工程规范 |
| 6 | 你所改模块的 [FDS](FDS/README.md) |

## 2. 本地开发

```bash
pnpm install
pnpm run dev:prepare
pnpm run dev
```

- 前端：Vite 默认端口见终端输出。  
- 后端：Fastify，配置见 `server/.env.development`。  

**推荐（与生产 Compose 一致）**：

```bash
pnpm run dev:compose
# 停止：pnpm run dev:compose:down
```

- 面板 API：`http://localhost:3000`；前端开发服：`http://localhost:9000`（见 `docker-compose.dev.yml`）。  
- 需本机 Docker 与 socket 挂载；实例启停会在宿主机创建 `game-<instanceId>-master` 等容器。

## 3. 提交流程

1. 从 `TODO.md` 或 Issue 认领任务，避免重复劳动。  
2. 按 [MODULE-KICKOFF.md](MODULE-KICKOFF.md) 完成阅读与自检后再改代码。  
3. **新功能**必须先有或更新 FDS，再写代码。  
4. 遵循现有代码风格；Vue 使用 Composition API + `<script setup lang="ts">`。  
5. API 变更同步 [API.md](API.md) 与 `shared/contracts`。  
6. 架构决策新增 [adr/](adr/) 条目。  
7. PR 描述说明：模块、Community/Pro、是否需 M0 回归。

## 4. 文档维护

| 变更类型 | 更新文档 |
|---------|---------|
| 产品范围 | PRD、TODO |
| 交互/验收 | 对应 FDS |
| 名词/表结构 | DOMAIN |
| 接口 | API |
| 部署/运行时 | ARCHITECTURE、RUNBOOK |
| Pro 边界 | TODO §8 |
| 发布前 | ACCEPTANCE 执行记录 |

## 5. 提交信息

遵循仓库 [git-commit-conventions](../.cursor/rules/git-commit-conventions.mdc)：**简体中文** Conventional Commits。

示例：

```text
feat(game-server-hub/instance): 容器运行时启动 DST Master

- server/infra: ContainerRuntime 接口
- instance: 启动流程改调 Docker
```

## 6. 行为准则

- 尊重 Klei / Valve 商标与服务条款；面板为非官方工具。  
- 勿提交密钥、`.env`、本地 `*.sqlite`、大体量存档。  
- 友善讨论，PR 以可维护性为先。

## 7. 问题反馈

- Bug：提供复现步骤、环境、相关日志路径（见 RUNBOOK）。  
- 功能建议：先对照 PRD/TODO 是否已在范围外，再开 Issue。

---

*文档索引：[README.md](README.md)*
