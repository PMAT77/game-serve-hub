# 新模块开发前必读文档指南

> 最后更新：2026-05-19  
> 用途：在动手写业务代码之前，明确「读什么、读到哪、对应哪份 FDS」；与 Cursor 规则 `module-kickoff-doc-sync` 配套使用。  
> 模块清单与状态以 [`TODO.md`](TODO.md) §2 与 [`FDS/README.md`](FDS/README.md) 为准。

---

## 1. 使用方式

1. 从 [`TODO.md`](TODO.md) §2 确认目标**模块 ID**与当前状态（已实现 / 部分实现 / 规划态）。
2. 阅读本文 **§2 全模块共性必读**（不可跳过）。
3. 打开本文 **§3** 中该模块对应行，按「必读 / 建议 / 上游 FDS」顺序阅读。
4. 通读本模块 **FDS 全文**（含验收标准 §9、边界 §7）。
5. 用 **§4 开工核对清单** 自检后再写代码。
6. 模块**确认完工**后，按 **§7** 同步文档（须用户明确确认，见 §7.1）。

**硬约束**

- **无 FDS 不开工**：无对应 `docs/FDS/xx-*.md`，或未写明「沿用 FDS-xx §n」时，不得实现业务功能；须先补/更新 FDS。
- **先读再写**：未完成 §2 + §3 指定阅读，不进入实现。
- **术语对齐**：v1 仅 DST；**房间 = Cluster（模块 03）**、**世界 = Shard（模块 04）**；**监控台（01）≠ 实例控制台（09）**；M0 优先容器运行时（模块 00）。
- **事实来源**：实现状态以 `server/src`、`src/views`、`docs/FDS/*` 为准，勿仅凭 PRS 推断已交付能力。

---

## 2. 全模块共性必读

以下文档**每个模块开工前都应阅读**（规划态模块同样适用，用于理解边界与依赖）。

| 优先级 | 文档 | 阅读重点 |
|--------|------|----------|
| P0 | [`01-PRODUCT-VISION-MISSION.md`](01-PRODUCT-VISION-MISSION.md) | v1 定位、用户痛点、Community/Pro 方向 |
| P0 | [`03-PRS.md`](03-PRS.md) | 需求总览；本模块在 PRS §2 中的条目 |
| P0 | [`TODO.md`](TODO.md) | §2 模块状态；§3 所属里程碑；§4 当前迭代待办；§5 Community/Pro 边界 |
| P0 | **本模块 FDS** `FDS/xx-*.md` | 范围、接口、规则、异常、验收 |
| P0 | [`FDS/README.md`](FDS/README.md) | FDS 统一章节结构、状态口径 |
| P0 | [`09-DEVELOPMENT-STANDARDS.md`](09-DEVELOPMENT-STANDARDS.md) | 前后端、迁移、安全、提交规范 |
| P0 | [`10-PROJECT-STRUCTURE-STANDARD.md`](10-PROJECT-STRUCTURE-STANDARD.md) | `src/`、`server/src/`、`docs/` 目录约定 |
| P1 | [`05-SYSTEM-ARCHITECTURE-DESIGN.md`](05-SYSTEM-ARCHITECTURE-DESIGN.md) | 模块划分、数据流、技术决策 |
| P1 | [`04-BUSINESS-FLOWS-STATE-MACHINES.md`](04-BUSINESS-FLOWS-STATE-MACHINES.md) | 登录、实例生命周期、状态机 |
| P1 | [`07-API-STANDARD-AND-DOCS.md`](07-API-STANDARD-AND-DOCS.md) | 统一响应壳、REST 约定、现有接口清单 |
| P2 | [`08-TECH-STACK-REPORT.md`](08-TECH-STACK-REPORT.md) | 技术栈与选型理由 |
| P2 | [`11-ACCEPTANCE-TEST-STANDARD.md`](11-ACCEPTANCE-TEST-STANDARD.md) | 模块/系统验收口径（收尾前必读） |

**涉及持久化或表结构时追加**：[`06-DATABASE-DESIGN.md`](06-DATABASE-DESIGN.md) 及 `server/src/shared/db` 实际 schema。

**涉及 DST 房间/世界/Mod/控制台命令时追加**：[`others/DST.md`](others/DST.md)。

---

## 3. 按 FDS 模块（00–14）的阅读映射

说明：

- **必读**：除 §2 共性文档外，该模块额外必须阅读的主文档 / 上游 FDS。
- **建议**：按实现范围选读，可显著降低返工。
- **代码路径**：当前或规划中的主要落点，便于对照 FDS 与实现差距。
- **状态**：与 `TODO.md` §2 同步；开工前请再确认一次。

### 3.1 总表

| 模块 ID | FDS | 模块名称 | 状态 | 必读（除 §2） | 建议 | 上游 FDS | 主要代码路径 |
|---------|-----|----------|------|---------------|------|----------|----------------|
| 00 | [00-install-runtime](FDS/00-install-runtime.md) | 平台安装与运行时 | 已实现 | `08-TECH-STACK`；根目录 `scripts/`、`docker-compose` 相关 | `05` 基础设施层 | — | `server/src/infra/container/`、`server/src/infra/docker*.ts`、`scripts/` |
| 01 | [01-monitor](FDS/01-monitor.md) | 监控台 | 部分实现 | [FDS-00](FDS/00-install-runtime.md) | `05` §2.1 前端层、`system` 模块 | 00 | `server/src/modules/system/`（metrics）、`src/views/console/monitor/` |
| 02 | [02-node-instance](FDS/02-node-instance.md) | 节点与实例 | 已实现 | [FDS-00](FDS/00-install-runtime.md)、[FDS-14](FDS/14-game-adapter.md)；`06` §2.2 | `04` 实例创建/安装/启停泳道 | 00、14 | `server/src/modules/node/`、`instance/`；`src/views/node/instance/` |
| 03 | [03-dst-cluster](FDS/03-dst-cluster.md) | DST 房间（Cluster） | 规划态 | [FDS-02](FDS/02-node-instance.md)、[FDS-14](FDS/14-game-adapter.md)；`others/DST.md` | `07` 配置读写原则（规划接口） | 02、14 | `server/src/infra/game-adapter/dst/cluster-config.ts`；`instance` 扩展 |
| 04 | [04-dst-shard](FDS/04-dst-shard.md) | DST 世界（Shard） | 规划态 | [FDS-03](FDS/03-dst-cluster.md)、`others/DST.md` | `04` 多世界编排相关状态 | 02、03、14 | `server/src/infra/game-adapter/dst/` |
| 05 | [05-mod](FDS/05-mod.md) | Mod 管理 | 规划态 | [FDS-02](FDS/02-node-instance.md)；`06` §2.4 `instance_mods`；`others/DST.md` modoverrides | [FDS-07](FDS/07-config.md) 配置写入边界 | 02 | `server/src/modules/mod/`（占位） |
| 06 | [06-backup](FDS/06-backup.md) | 备份恢复 | 规划态 | [FDS-02](FDS/02-node-instance.md)；`06` §2.4 `backups` | [FDS-08](FDS/08-file.md) 路径与权限 | 02 | `server/src/modules/backup/`（占位） |
| 07 | [07-config](FDS/07-config.md) | 配置中心 | 规划态 | [FDS-02](FDS/02-node-instance.md)、[FDS-03](FDS/03-dst-cluster.md)；`others/DST.md` | `04` 配置变更与重启影响 | 02、03 | `server/src/modules/config/`（占位）；`game-adapter/dst/` |
| 08 | [08-file](FDS/08-file.md) | 文件管理 | 规划态 | [FDS-02](FDS/02-node-instance.md)；`05` §2.3 filesystem；`09` §7 安全 | [FDS-06](FDS/06-backup.md) 若含导出 | 02 | `server/src/modules/file/`（占位）；`server/src/infra/filesystem-browse.ts` |
| 09 | [09-console](FDS/09-console.md) | 实例控制台 | 已实现 | [FDS-02](FDS/02-node-instance.md)；`others/DST.md` §3 控制台命令 | `04` 控制台链路；SSE/轮询约定 | 02 | `server/src/modules/console/`；`src/views/node/instance/console.vue` |
| 10 | [10-player-access](FDS/10-player-access.md) | 玩家与访问 | 规划态 | [FDS-03](FDS/03-dst-cluster.md)；`03-PRS` 访问控制相关 | `TODO` §5 Pro 边界 | 03 | 待建（规划态） |
| 11 | [11-scheduler](FDS/11-scheduler.md) | 计划任务 | 规划态 | [FDS-02](FDS/02-node-instance.md)；`TODO` §3.4 M3、`§5` Pro | [FDS-09](FDS/09-console.md)、[FDS-06](FDS/06-backup.md) 可编排动作 | 02 | 待建（规划态） |
| 12 | [12-notice-audit](FDS/12-notice-audit.md) | 通知与审计 | 规划态 | `TODO` §3.4 M3、`§5` Pro；`03-PRS` 可观测/审计 | 各业务模块事件形态（先读相关 FDS §5） | 02 及被观测模块 | 待建（规划态） |
| 13 | [13-onboarding](FDS/13-onboarding.md) | 新手引导 | 部分实现 | `03-PRS`；[FDS-02](FDS/02-node-instance.md) 实际入口 | `01` 监控台、`09` 控制台页面路由 | 02（能力对齐） | 前端引导组件/路由 meta；`src/views/` |
| 14 | [14-game-adapter](FDS/14-game-adapter.md) | 游戏适配器 | 部分实现 | [FDS-02](FDS/02-node-instance.md)；`05` §2.3 adapter | `others/DST.md`；`08` 扩展性 | 02（双向） | `server/src/infra/game-adapter/dst/`；`instance` 安装/运行分流 |

### 3.2 分模块阅读要点（速查）

#### FDS-00 平台安装与运行时

- **目标**：安装脚本、Compose、Docker 运行时探活与封装。
- **必读细节**：FDS §6 运行时不可用时的拒绝策略；§7 Docker/镜像/目录异常。
- **验收**：FDS §9 + `11-ACCEPTANCE` §2.1 模块 00。

#### FDS-01 监控台

- **目标**：主机资源与网络监控；**不做**实例命令与日志。
- **必读细节**：FDS §6 与控制台职责分离；`system/info`、`network/realtime` 接口。
- **验收**：`11-ACCEPTANCE` §2.1 模块 01。

#### FDS-02 节点与实例

- **目标**：M0 核心——节点注册、实例全生命周期。
- **必读细节**：`04` 实例状态机；`06` `game_instances` 字段；FDS §6 单节点与删除清理规则。
- **验收**：`11-ACCEPTANCE` §2.1 模块 02；`TODO` §3.1 M0 清单。

#### FDS-03 DST 房间（Cluster）

- **目标**：`cluster.ini` 可视化读写；v1 保持 **1 实例 : 1 Cluster**。
- **必读细节**：`others/DST.md` §2；FDS §6 运行中修改需提示重启。
- **验收**：FDS §9（规划接口落地后执行）。

#### FDS-04 DST 世界（Shard）

- **目标**：多世界/洞穴分片配置与编排。
- **必读细节**：`others/DST.md` §4；依赖 Cluster 已可用。
- **验收**：与 03 联动场景需在 FDS 中写清。

#### FDS-05 Mod 管理

- **目标**：Workshop Mod 安装、启用、`modoverrides.lua` 维护。
- **必读细节**：`06` `instance_mods`；DST §2 modoverrides；运行中变更风险（FDS §6）。

#### FDS-06 备份恢复

- **目标**：实例数据备份/恢复与元数据管理。
- **必读细节**：`06` `backups` 表；存储路径与权限（FDS §2、§7）。

#### FDS-07 配置中心

- **目标**：实例级配置集中读写（含 server.ini 等）。
- **必读细节**：与 03/04 的分工；原子写入（FDS §8）。

#### FDS-08 文件管理

- **目标**：实例目录内受控文件浏览与操作。
- **必读细节**：`09-DEVELOPMENT` §7 路径安全；`filesystem-browse` 现有能力。

#### FDS-09 实例控制台

- **目标**：日志、SSE、命令下发；**不是**监控台。
- **必读细节**：FDS §6 仅运行中可写命令；DST 命令表。
- **验收**：`11-ACCEPTANCE` §2.1 模块 09。

#### FDS-10 玩家与访问

- **目标**：白名单、封禁、访问策略（规划）。
- **必读细节**：依赖 Cluster 配置；Pro 能力见 `TODO` §5。

#### FDS-11 计划任务

- **目标**：定时启停、备份、重启等编排（偏 Pro）。
- **必读细节**：FDS §2 前置「实例与系统可提供可调用动作」；先确认 02/06/09 接口形态。

#### FDS-12 通知与审计

- **目标**：事件通知与操作审计（偏 Pro）。
- **必读细节**：FDS §2 结构化事件；实现前对齐各模块 §5 接口是否产出可审计字段。

#### FDS-13 新手引导

- **目标**：首次使用路径与关键页面引导。
- **必读细节**：引导文案必须与 `TODO` §2 真实状态一致，禁写未实现入口。

#### FDS-14 游戏适配器

- **目标**：按 `gameCode` 隔离安装/目录/运行规格；v1 仅 DST `343050`。
- **必读细节**：FDS §6 非支持游戏拒绝；与 02 生命周期衔接。
- **验收**：`11-ACCEPTANCE` §2.1 模块 14。

---

## 4. 开工核对清单（模板）

在 PR / 分支描述或团队 Issue 中可复制使用：

```markdown
## 模块开工核对 — FDS-XX（模块名）

- [ ] 已读 MODULE-KICKOFF.md §2 共性必读
- [ ] 已读 MODULE-KICKOFF.md §3 本模块行 + 上游 FDS
- [ ] 已通读 FDS/xx-*.md（含 §7 异常、§9 验收）
- [ ] 已核对 TODO.md §2 状态与 §3 里程碑
- [ ] 已确认 Community/Pro 边界（TODO §5）
- [ ] 已定位主要代码路径并与 FDS §5 接口对照
- [ ] 规划态：已在 FDS 标明「未实现能力」与前置条件
- [ ] 无 FDS 或范围不清：已暂停实现并先更新 FDS
```

**用户派工时建议 @ 文档**：`MODULE-KICKOFF.md`、`FDS/xx-*.md`、`TODO.md`、`03-PRS.md`；若动 API/库表则加 `07-API`、`06-DATABASE`。

---

## 5. 里程碑与模块对应（阅读顺序提示）

| 里程碑 | 模块 ID | 阅读顺序建议 |
|--------|---------|----------------|
| M0 可运行闭环 | 00 → 14 → 02 → 09 | **已完成**（2026-05-19）；回归见 `M0-M1-REGRESSION.md` |
| M1 管理能力 | 01、03、04、07 | **当前迭代**；监控增强；Cluster/Shard/配置 |
| M2 运维效率 | 05、06、08、10、13 | Mod、备份、文件、玩家、引导 |
| M3 自动化治理 | 11、12 | 计划任务、通知审计（Pro 为主） |

---

## 6. 易混淆边界（开工前默念）

| 概念 A | 概念 B | 区分 |
|--------|--------|------|
| 监控台（01） | 实例控制台（09） | 前者看主机/网络资源；后者对单实例日志与命令 |
| Cluster（03） | Shard（04） | 房间级 `cluster.ini` vs 世界/洞穴分片 |
| 实例（02） | 房间（03） | v1：一实例对应一 Cluster 目录，不混为多实例多房间 |
| 配置中心（07） | Cluster 编辑（03） | 07 偏通用配置聚合；03 偏 DST 房间语义 |
| 文件管理（08） | 系统目录浏览 | 08 限实例目录；系统模块浏览受全局根路径约束 |
| Community | Pro | 以 `TODO.md` §5 与各 FDS「Community/Pro 规划」标注为准 |

---

## 7. 模块完工后的文档同步

### 7.1 何时可以改文档

**必须**收到用户明确确认后才可执行同步，例如：

- 「模块 X 已确认完成，请同步文档」
- 「按 MODULE-KICKOFF §7 同步文档」

以下**不构成**确认：仅说「做完了」「先这样」「继续」；仅 `git commit`；测试通过但用户未确认验收。

### 7.2 确认后必做

| 必做 | 说明 |
|------|------|
| [`TODO.md`](TODO.md) | §2 状态、§4 待办勾选、§7 验收映射 |
| [`07-API-STANDARD-AND-DOCS.md`](07-API-STANDARD-AND-DOCS.md) | 新增/变更接口（项目若单独维护 `API.md` 则一并更新） |
| 本模块 `FDS/xx-*.md` | 状态、接口 §5、验收 §9 与实现一致 |

### 7.3 有变更才改（选做）

| 文档 | 触发条件 |
|------|----------|
| [`03-PRS.md`](03-PRS.md) | 需求边界或模块清单变化 |
| [`05-SYSTEM-ARCHITECTURE-DESIGN.md`](05-SYSTEM-ARCHITECTURE-DESIGN.md) | 模块划分或主数据流变化 |
| [`06-DATABASE-DESIGN.md`](06-DATABASE-DESIGN.md) | 表结构或实体关系变化 |
| [`04-BUSINESS-FLOWS-STATE-MACHINES.md`](04-BUSINESS-FLOWS-STATE-MACHINES.md) | 核心流程或状态机变化 |
| [`11-ACCEPTANCE-TEST-STANDARD.md`](11-ACCEPTANCE-TEST-STANDARD.md) | 验收标准调整 |
| [`FDS/14-game-adapter.md`](FDS/14-game-adapter.md) | 其他模块改动适配器契约 |
| `shared/` 契约 | 前后端共享类型或错误码变更 |

一般**不在此同步**：`01-PRODUCT-VISION`、`02-MARKET-*`、根 `README.md`（除非用户另行要求）。

### 7.4 同步完成汇报模板

```markdown
## 文档同步汇报 — 模块 XX

- 已更新：<文件列表>
- 状态摘要：<TODO §2 与 FDS 状态是否一致>
- FDS 一致性：<实现与 FDS 差异说明，无则写「一致」>
- 遗留项：<未做能力>
- 建议验收：<场景列表，可引用 FDS §9 / 11-ACCEPTANCE>
```

---

## 8. 历史文档名对照

仓库曾使用或规则中引用的文件名，与当前 `docs/` 编号文档对应关系如下（阅读时以**右侧现行文件**为准）：

| 历史/规则中的名称 | 现行文档 |
|-------------------|----------|
| `DOMAIN.md` | `others/DST.md` + FDS-03/04/14 + `06-DATABASE` 实例域 |
| `ARCHITECTURE.md` | `05-SYSTEM-ARCHITECTURE-DESIGN.md` |
| `PROJECT_BASELINE.md` | `03-PRS.md` + `TODO.md` §1–§3 |
| `API.md` | `07-API-STANDARD-AND-DOCS.md` |
| `ACCEPTANCE.md` | `11-ACCEPTANCE-TEST-STANDARD.md` |
| `PRD.md` | `03-PRS.md`（需求总览） |
| `ROUTES.md` | 前端 `src/router` + 后端 `auth` 动态路由；暂无独立文档 |
| `adr/` | 暂无目录；重大决策写入 `05` 或后续 `docs/adr/` |

---

## 9. 相关索引

- FDS 列表：[`FDS/README.md`](FDS/README.md)
- 任务与里程碑：[`TODO.md`](TODO.md)
- DST 运维参考：[`others/DST.md`](others/DST.md)
- Cursor 规则：`.cursor/rules/module-kickoff-doc-sync.mdc`
