# 新模块开工指南

> 适用于：新功能模块、跨前后端的大改、或让 AI（Cursor Agent）接手实现某模块前。  
> **私有仓**内维护；对外开源仓不推送（见 [TODO.md §13](TODO.md#13-开源发布与仓库策略)）。

---

## 1. 开工前必须满足的文档条件

| 条件 | 说明 |
|------|------|
| FDS 已存在或已更新 | 无 FDS 不得写业务代码；小改动需在 Issue/PR 注明「沿用 FDS-xx §n」 |
| TODO 中有对应任务 | 确认优先级 P0/P1、里程碑 M0–M4、依赖项已读 |
| Community/Pro 已标注 | 功能点落在 FDS §6 与 [TODO §8](TODO.md#8-community--pro-功能对照表) |

若产品范围变化：先改 [PRD.md](PRD.md) → 再改 FDS → 再改 [TODO.md](TODO.md)。

---

## 2. 应当阅读什么（按顺序）

### 2.1 全员必读（每个模块）

| 顺序 | 文档 | 关注什么 |
|------|------|----------|
| 1 | [DOMAIN.md](DOMAIN.md) | 房间/世界/实例/路径/表字段；**禁止自造名词** |
| 2 | [TODO.md](TODO.md) §4、§6、§7 | 实现状态、里程碑退出标准、**本模块任务行** |
| 3 | **本模块 [FDS](FDS/README.md)** | 用户流程、页面、API 草案、异常、验收标准 |
| 4 | [PROJECT_BASELINE.md](PROJECT_BASELINE.md) | 目录边界、`views → api`、模块注册方式 |
| 5 | [ARCHITECTURE.md](ARCHITECTURE.md) + 相关 [ADR](adr/) | 容器运行时、模块分层、安全边界 |

### 2.2 按角色追加

| 角色 | 追加阅读 |
|------|----------|
| 后端 | [API.md](API.md)、`server/src/modules/README.md`、现有模块 `index.ts`（auth/instance 等作参考） |
| 前端 | [ROUTES.md](ROUTES.md)、[DESIGN.md](DESIGN.md)、`src/api/modules/app.fake.ts`（菜单规划） |
| 涉及 DST 行为 | [DST-OPS.md](DST-OPS.md)、[FDS-14 游戏适配器](FDS/14-game-adapter.md) |
| 涉及安装/容器 | [FDS-00](FDS/00-install-runtime.md)、[ADR-001](adr/001-full-containerization.md) |
| 含 Pro 能力 | [TODO §8](TODO.md#8-community--pro-功能对照表)、`GSH_EDITION` 占位约定 |
| 发布相关 | [ACCEPTANCE.md](ACCEPTANCE.md) 对应场景 |

### 2.3 模块与 FDS 对照（开工时 @ 对文档）

| 模块 ID | 模块名 | FDS | 后端占位/注册 |
|---------|--------|-----|----------------|
| 0 | 平台 / 安装 / 运行时 | [FDS-00](FDS/00-install-runtime.md) | `scripts/`、`server/src/infra/` |
| 1 | 监控台 | [FDS-01](FDS/01-monitor.md) | `system`、`console/monitor` 页 |
| 2 | 节点与实例 | [FDS-02](FDS/02-node-instance.md) | `node`、`instance` |
| 3 | DST 房间 | [FDS-03](FDS/03-dst-cluster.md) | 规划 `dst` 或 `instance` 子域 |
| 4 | DST 世界 | [FDS-04](FDS/04-dst-shard.md) | 同上 |
| 5 | Mod | [FDS-05](FDS/05-mod.md) | `mod`（未注册） |
| 6 | 备份 | [FDS-06](FDS/06-backup.md) | `backup`（未注册） |
| 7 | 配置中心 | [FDS-07](FDS/07-config.md) | `config`（未注册） |
| 8 | 文件管理 | [FDS-08](FDS/08-file.md) | `file`（未注册） |
| 9 | 实例控制台 | [FDS-09](FDS/09-console.md) | `console` |
| 10 | 玩家与访问 | [FDS-10](FDS/10-player-access.md) | 规划 |
| 13 | 新手引导 | [FDS-13](FDS/13-onboarding.md) | 前端 |
| 14 | 游戏适配器 | [FDS-14](FDS/14-game-adapter.md) | `instance` + `infra/game-adapter` |

---

## 3. 必须注意什么（易跑偏清单）

### 3.1 产品与范围

- v1 **仅 DST**（`gameCode` / AppID `343050`）；不要顺手做泰拉瑞亚/Valheim。
- **房间 = Cluster**，**世界 = Shard**（Master/Caves），与 [DOMAIN](DOMAIN.md) 一致。
- v1 **1 实例 : 1 Cluster**（[ADR-002](adr/002-one-instance-one-cluster.md)）。
- **Community** 须在单机完成 DST 闭环；Pro 功能用 `isProEdition()` / `GSH_EDITION`，勿默认只实现 Pro。

### 3.2 架构与运行时

- **M0 目标**：全容器化；新代码优先 `ContainerRuntime`，避免新增宿主机 `child_process` 路径（除非明确过渡并标 TODO）。
- 标注 **「需 M0 回归」** 的已有能力：改完后在 Compose 下重验。
- 模块只通过 `server/src/modules/*/index.ts` 注册；**禁止**跨模块直接 import 内部文件。
- 游戏相关逻辑进 **GameAdapter**（[FDS-14](FDS/14-game-adapter.md)），避免在 `instance` 里堆更多 `if (gameCode === '343050')`。

### 3.3 API 与前端

- REST 资源名词、方法语义见仓库规则 `api-rest-conventions`：列表可用 `POST` 与现网一致。
- 响应结构：`shared/constants/error-code` + `server/src/shared/http/response.ts`。
- 鉴权：请求头 `token`；改密拦截见 `auth` 模块。
- 前端：Vue 3 `<script setup lang="ts">`；页面 UI 优先 Naive UI / 框架 Fa* 组件（见 `ui-naive-ui-page-design` 规则）。
- **监控台**（`/console/monitor`）≠ **实例控制台**（`/node/instance/console/:id`），勿混 API 与文案。

### 3.4 安全与运维

- 实例路径校验：禁止 `..`、系统敏感目录（参考 `validateInstallPath`）。
- 控制台命令：运行中才可发；危险操作（重置世界等）需 FDS 规定的确认级别。
- Docker socket 访问遵循 [ARCHITECTURE](ARCHITECTURE.md) 最小权限。
- 不提交 `.env`、`*.sqlite`、密钥、用户存档。

### 3.5 文档与提交

- 开发过程中：**勿**为「模块完工」提前改 [TODO.md](TODO.md) §4/§7、[API.md](API.md)、FDS 等；须等你 **§7 确认** 后由 Agent 同步（见 `.cursor/rules/module-kickoff-doc-sync.mdc`）。
- 确认后：按 §7 更新 API、TODO、FDS 等；类型进 `shared/contracts`（若已启用）。
- 架构决策变更新增 `docs/adr/NNN-*.md`（重大变更可在确认时一并做）。
- Git 提交：**简体中文** Conventional Commits（见 `.cursor/rules/git-commit-conventions.mdc`）；`git commit` 不等于文档同步许可。

---

## 4. 告知 AI（Cursor Agent）的推荐方式

新开对话或派工前，用下面模板可减少跑偏。**把尖括号换成实际值**。

```markdown
## 任务
实现模块：<模块名>（模块 ID：<0-14>）
范围：<一句话，如「DST 房间 Cluster CRUD + 页面」>

## 必读（请先阅读再改代码）
@docs/DOMAIN.md
@docs/TODO.md（§4 §6 §7 中与模块相关部分）
@docs/FDS/<对应 FDS 文件>.md
@docs/PROJECT_BASELINE.md
@docs/ARCHITECTURE.md
<若涉及容器> @docs/adr/001-full-containerization.md
<若涉及 DST> @docs/DST-OPS.md
<若含 Pro> @docs/TODO.md §8

## 约束
- Community/Pro：<本任务只做 Community | 含 Pro 项 xxx>
- 里程碑：<M0|M1|M2>；依赖：<如 M0 ContainerRuntime 未完成则只 mock 接口>
- 勿改动：<列出不要碰的文件/模块>
- 验收：按 FDS §9 与 ACCEPTANCE 场景 <字母>

## 交付
- 代码 + 更新 API.md / TODO 状态 / 必要时 ADR
- 不要提交 git（除非我明确要求）
```

### 4.1 对不同模块的补充 @

| 场景 | 额外 @ |
|------|--------|
| 新后端模块 | `@server/src/app.ts`、`@server/src/modules/<相近模块>/index.ts` |
| 新页面 | `@src/api/modules/app.fake.ts`、`@.cursor/rules/vue-ts-coding-conventions.mdc` |
| 改实例生命周期 | `@docs/FDS/02-node-instance.md`、`@server/src/modules/instance/index.ts` |
| Mod/备份/配置/文件 | 对应 FDS + 占位 `server/src/modules/<name>/index.ts` |

### 4.2 希望 AI 主动做的事

1. 对照 FDS §9 自检验收项。  
2. 列出与现有实现的冲突或需 ADR 的点，**再写代码**。  
3. 若 FDS 与代码不一致，**先问**以 FDS 为准还是以代码为准。  
4. 不扩大范围（不顺手重构、不新增未列游戏、不改公开仓策略文档除非指派）。

### 4.3 希望 AI 不要做的事

- 不要跳过 FDS 直接实现「想象的需求」。  
- 不要修改 `docs/TODO.md` §13 开源策略除非指派。  
- 不要 `git commit` / `git push` 除非用户明确要求。  
- 不要为对外 README 写内部里程碑（M0–M4 细节）——公开仓瘦身前仅维护私有仓文档。

---

## 5. 开工自检表（可复制）

```text
[ ] 已读 DOMAIN + 本模块 FDS + TODO 对应行
[ ] 已确认 Community/Pro 边界
[ ] 已确认是否依赖 M0 / 其他模块
[ ] 已看同类模块代码（前后端各至少 1 处）
[ ] 已规划路由与 API（对照 ROUTES.md、API.md）
[ ] 已知监控台 vs 实例控制台区分
[ ] 用户确认完成后：按 §7 同步文档（由 Agent 执行）
```

---

## 7. 用户确认完成后应同步的文档

> **触发时机**：你**明确确认**模块完成后（见 §7.5 话术），Agent 方可更新下列文档；未确认前不得同步（仓库规则 `module-kickoff-doc-sync.mdc`）。  
> **原则**：代码为事实来源；文档与实现不一致时，以你已确认的行为为准修订文档。

### 7.1 必做（几乎每个模块）

| 文档 | 更新内容 |
|------|----------|
| **[TODO.md](TODO.md) §4** | 「实现状态总览」表中该领域一行：状态改为 `[x]` 或 `[~]`，说明一句与代码一致 |
| **[TODO.md](TODO.md) §7** | 本模块任务表中对应行勾选 `[x]`；若部分完成标 `[~]` 并注明缺口 |
| **[API.md](API.md)** | 「规划」改为「已实现」；补全方法、路径、简要说明；删除或标注已废弃接口 |
| **本模块 [FDS](FDS/README.md)** | §6 功能清单状态；若实现与 FDS 有偏差，改 FDS §8/§9 或补「实现说明」脚注，**勿留静默不一致** |

### 7.2 按实际情况选做

| 条件 | 文档 | 更新内容 |
|------|------|----------|
| 新增/变更表字段、路径、概念 | **[DOMAIN.md](DOMAIN.md)** | 表结构、目录树、状态机、端口约定 |
| 新增路由或菜单 | **[ROUTES.md](ROUTES.md)** | 路径、name、权限、`menu: false` 等 |
| 部署/容器/模块依赖变化 | **[ARCHITECTURE.md](ARCHITECTURE.md)** | 拓扑、模块列表、差距表 |
| 重要架构抉择 | **新建/更新 [adr/](adr/)** | 背景、决策、后果 |
| 里程碑阶段完成 | **[TODO.md](TODO.md) §6** | 对应 M0–M4「退出标准」勾选 |
| 可走通验收场景 | **[ACCEPTANCE.md](ACCEPTANCE.md)** | 场景步骤旁标注「已测 / 日期」或 README 链到 Release |
| Community/Pro 边界变化 | **[TODO.md](TODO.md) §8** | 对照表；必要时 FDS §6 标注 |
| 涉及 Klei 行为澄清 | **[DST-OPS.md](DST-OPS.md)** | 命令、路径、端口（DST 相关模块） |
| 安装/排障变化 | **[RUNBOOK.md](RUNBOOK.md)** | 新日志路径、命令、常见错误 |
| 新游戏或适配器接口 | **[FDS-14](FDS/14-game-adapter.md)** | 接口与检查清单 |
| `shared/contracts` 已用 | **类型文件** | 与 API.md 一致（非 docs，但属契约同步） |

### 7.3 一般不在确认时改（除非你有要求）

| 文档 | 原因 |
|------|------|
| [PRD.md](PRD.md) | 仅产品范围变更时改 |
| [TODO.md](TODO.md) §11 本周开工 | 滚动区，非模块收尾 |
| [TODO.md](TODO.md) §13 开源策略 | 仅公开仓瘦身/账号变更时改 |
| 根 [README.md](../README.md) | 仅**对外**特性列表、安装方式变化时改；内部里程碑细节不写 README |
| [DESIGN.md](DESIGN.md) | 仅 UI/视觉规范变化时改 |

### 7.4 Agent 收尾汇报（建议你要求的标准输出）

确认通过后，Agent 应简短列出：

1. 已更新的文档路径清单  
2. TODO §4 / §7 状态变化摘要  
3. FDS 与实现是否一致；若有意偏差，写清原因  
4. 尚未勾选的 `[ ]`（技术债、M0 回归、Pro 项）  
5. 建议你是否执行 [ACCEPTANCE](ACCEPTANCE.md) 哪几个场景  

### 7.5 你可用的确认话术

```text
模块 <ID/名称> 已确认完成，请按 MODULE-KICKOFF §7 同步文档。
<可选> 验收场景：C、D；无需改 PRD/README。
```

---

## 8. 与其他文档的关系

| 文档 | 关系 |
|------|------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | 提交流程与行为准则；本指南是「开工前」细化 |
| [FDS/README.md](FDS/README.md) | 功能设计模板与索引 |
| [TODO.md §12](TODO.md#12-文档体系与维护规则) | 文档分层；开工指向 §1–§5，**确认后指向 §7** |

---

*最后更新：2026-05-18*
