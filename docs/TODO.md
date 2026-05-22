# Game Server Hub 开发任务清单（重建版）

> 最后同步：2026-05-22（**M0 已完成**；**M1 模块 03/04** 已验收；Open Core 架构文档已发布）  
> 状态口径：已实现 / 部分实现 / 规划态  
> 事实来源：`server/src`、`src/views`、`docs/FDS/*`

## 1. 当前版本定位

- v1 聚焦 DST（`gameCode=343050`）自托管闭环。
- 优先保证单节点可用，再逐步扩展多节点与自动化运维能力。
- Community / Pro 分层采用 **Open Core（C 方案）**，技术权威见 [`13-PRO-OPEN-CORE-ARCHITECTURE.md`](13-PRO-OPEN-CORE-ARCHITECTURE.md)。

## 2. 模块状态总览（0-14）


| 模块ID | 模块名             | 状态       | 对应 FDS                      |
| ---- | --------------- | -------- | --------------------------- |
| 00   | 平台安装与运行时        | 已实现      | `FDS/00-install-runtime.md` |
| 01   | 监控台             | 部分实现     | `FDS/01-monitor.md`         |
| 02   | 节点与实例           | 已实现（单节点） | `FDS/02-node-instance.md`   |
| 03   | DST 房间（Cluster） | 已实现（M1 Community） | `FDS/03-dst-cluster.md`     |
| 04   | DST 世界（Shard）   | 已实现（M1 Community） | `FDS/04-dst-shard.md`       |
| 05   | Mod 管理          | 规划态      | `FDS/05-mod.md`             |
| 06   | 备份恢复            | 规划态      | `FDS/06-backup.md`          |
| 07   | 配置中心            | 规划态      | `FDS/07-config.md`          |
| 08   | 文件管理            | 规划态      | `FDS/08-file.md`            |
| 09   | 实例控制台           | 已实现（Community）；Pro 命令补全规划态 | `FDS/09-console.md`         |
| 10   | 玩家与访问           | 规划态      | `FDS/10-player-access.md`   |
| 11   | 计划任务            | 规划态（Pro-only） | `FDS/11-scheduler.md`       |
| 12   | 通知与审计           | 规划态      | `FDS/12-notice-audit.md`    |
| 13   | 新手引导            | 部分实现     | `FDS/13-onboarding.md`      |
| 14   | 游戏适配器           | 已实现（DST v1） | `FDS/14-game-adapter.md`    |


## 3. 里程碑拆分

## 3.1 M0（可运行闭环）— **已完成**（2026-05-19）

- [x] 后端核心模块接入：`auth/system/node/instance/console`
- [x] 实例生命周期基础闭环（创建 → SteamCMD 安装 → 启动 → 控制台 → 停止 → 删除）
- [x] SteamCMD 安装链路
- [x] Docker 运行时接入（SteamCMD + DST 运行镜像；`game-dst` 含 `libcurl3-gnutls`）
- [x] M0 回归用例 1–8 通过（见 `docs/M0-M1-REGRESSION.md` §M0 回归终局状态）
- [x] `pnpm test:server` 35/35

## 3.2 M1（管理能力补齐）

- [~] 监控台增强（容器摘要、异常提示）
- [x] Cluster 可视化管理（模块 03，2026-05-20 验收）
- [x] Shard 可视化管理（模块 04，2026-05-21 验收；见 FDS-04）
- 配置中心落地

### 3.2.1 规划：游戏内维护公告推送（未开工）

> **需求背景**：面板（`game-server-hub-panel`）与 DST 游戏容器（`gsh-*`）生命周期解耦——仅重启/更新面板时，游戏进程可继续运行，玩家通常不会掉线（见架构说明）。需在**面板维护前**主动通知在线玩家，避免「控制台不可用但游戏里仍在玩」的体验断层。  
> **本次范围**：仅记录开发计划，**不实现**；不含面板停止时自动推送、定时任务、Pro 外部通知通道。

**功能名称（建议）**：维护公告 → 游戏房间推送（区别于 FDS-12「站内通知」：后者给管理员看，本功能给**游戏内玩家**看）。

**用户故事**

1. 管理员计划在维护窗口内**仅重启/升级面板**（Compose 只动 `panel`/`web`，不停止 `gsh-*` 实例容器）。
2. 维护前在面板编辑公告文案（如：「10 分钟后面板升级，游戏服保持在线，暂无法打开管理页」）。
3. 管理员点击「推送到房间」，向选定**运行中**实例的主世界发送 DST 控制台公告；在线玩家在游戏内看到提示。
4. 确认玩家已收到提示后，管理员再重启面板；游戏服继续运行，玩家不掉线。

**职能边界**

| 归属 | 说明 |
|------|------|
| **做** | 公告草稿编辑与持久化；向运行中实例手动推送；推送记录（时间、操作者、目标实例、结果） |
| **不做（v1 规划外）** | 面板 `SIGTERM`/Compose `down` 时自动推送；倒计时自动停服；向洞穴分片单独推送（默认仅 Master）；模块 11 计划任务编排 |
| **与现有模块关系** | 推送走 FDS-09 已有 `POST /app/instance/console/command`（`docker exec` stdin）；UI 落在实例控制台「游戏控制」Tab 或实例级「维护」区块 |

**技术要点（实现时核对）**

- DST 需在 `-console` 启动前提下，通过 Lua 向全服广播（实现阶段对照 Klei Wiki / `docs/others/DST.md`，候选如 `TheNet:Announce("...")` 等等价 API，以实测为准）。
- 公告草稿建议存 SQLite（`gsh-data` 卷），面板重启后仍可编辑；可选按实例 ID 存「上次推送内容」便于复用。
- 推送前校验：实例 `running`、主世界容器存活；失败返回可读错误（未运行、命令执行失败等）。
- 分片房间：v1 仅对 **Master** 容器下发；洞穴进程不重复广播。
- 可选增强（ backlog）：推送到本节点全部运行中实例、公告模板、推送前预览、与 FDS-12 审计字段对齐。

**Open Core**：Community（基础编辑 + 单次手动推送）；Pro 扩展可预留「定时预告 / 维护窗口模板 / 多次重播」（entitlement 待定，实现前写入 FDS-09 §Open Core 落点）。

**建议里程碑**：M1+ 或 M2（运维效率），晚于实例控制台 Tab 与 `connect-info` 稳定。

**实现检查清单（规划，未开工）**

- [ ] FDS-09 增补「维护公告」小节（交互、接口、验收）
- [ ] 持久化：公告草稿 CRUD（按实例或全局维护单）
- [ ] API：`POST /app/instance/maintenance/announce`（或扩展现有 command 端点 + 专用 payload）
- [ ] 前端：实例控制台「游戏控制」维护公告编辑区 + 推送按钮 + 最近推送记录
- [ ] 文档：`DST-OPS` / RUNBOOK 增加「仅重启面板且保持游戏在线」推荐流程

### 3.2.2 规划：DST 控制台命令提示与补全（Pro-only，未开工）

> **需求背景**：饥荒 DST 控制台命令为 Lua 语法，管理员需记忆 `c_save()`、`c_rollback(n)`、`TheNet:Announce(...)` 等写法。Community 版已提供少量快捷按钮与普通文本输入，但**不含**输入时的命令提示与自动补全。  
> **本次范围**：仅记录 Pro 开发计划，**不在 Community（MIT）仓实现**；不含命令审计、服务端命令解析（仍走现有 `POST /app/instance/console/command` 透传 stdin）。

**功能名称（建议）**：DST 控制台命令库 + 输入补全（Pro）。

**用户故事**

1. Pro 管理员在实例控制台「面板与控制」Tab 输入命令时，获得前缀匹配的下拉候选（如输入 `c_rol` → `c_rollback(n)`）。
2. 选中候选后填入完整命令模板；带参数命令展示简要说明（如回档天数 1～6）。
3. 危险命令（如 `c_reset()`）选中或发送前仍走二次确认；与 Community 现有确认逻辑一致。
4. Community 用户保持现状：快捷按钮 + 普通输入框 + placeholder，**不出现**补全下拉或「升级 Pro」灰态控件。

**职能边界**

| 归属 | 说明 |
|------|------|
| **Community（MIT）** | 连接信息、日志 SSE、快捷指令（`c_save` / `c_rollback` / `c_reset`）、自定义命令输入与发送、分片选择（地上/洞穴） |
| **Pro（`@gsh/pro-console`）** | DST 命令静态库、输入补全 UI、命令说明/tooltip、可选自定义命令模板与最近使用历史 |
| **不做（v1 Pro 规划外）** | 从游戏进程动态拉取命令列表；服务端 Lua 语法校验；命令执行结果结构化解析 |

**技术要点（实现时核对）**

- 补全为**纯前端**能力：静态命令库 + 前缀/分类匹配；下发仍调用 Community 已有 `POST /app/instance/console/command`。
- Pro 包通过扩展点注入控制台命令输入区（如 `pro.ui.console.commandInput`），**不在** MIT 仓提交 `NAutoComplete`、命令库 JSON/TS 或模板 CRUD。
- 命令库数据源可参考 `docs/others/DST.md` §3 与 Klei Wiki；Pro 包内维护，可随 Pro 版本独立更新。
- Community 控制台页保留稳定扩展槽（占位/空插槽），供 Pro 挂载；未激活 Pro 时不渲染补全 UI。

**Open Core**：模块 09 为 **hybrid**；entitlement `console_commands`；详见 [FDS-09 §11 Open Core 落点](FDS/09-console.md)。

**建议里程碑**：M4（`@gsh/pro-console` 与 `@gsh/pro-audit` 等 Pro 模块扩展阶段）；晚于 M3-d 授权与 Pro 路由注入基础设施。

**实现检查清单（规划，未开工）**

- [ ] FDS-09 增补 Open Core 落点与 Pro 验收项（§11）
- [ ] Pro 包：`@gsh/pro-console` — 命令库、`registerProConsoleUi` 扩展点、可选 `GET /app/instance/console/command-templates`（Pro API）
- [ ] Community：控制台命令输入区扩展槽 stub；**禁止**实现补全逻辑或命令库数据
- [ ] 文档：同步 `TODO.md` §5、`COMMERCIAL.md` entitlement、`13-PRO-OPEN-CORE-ARCHITECTURE.md` §10

## 3.3 M2（运维效率）

- Mod 管理
- 备份恢复
- 文件管理
- [~] 新手引导完善
- 玩家与访问控制

## 3.4 M3（自动化与治理）

- 通知中心与审计（Community 基础 + Pro 外部通道）
- Pro 能力分层落地（按 §5 对照表）

## 3.5 M3+ Open Core / Pro 基础设施

> 不阻断 v1 开源；详见 [`13-PRO-OPEN-CORE-ARCHITECTURE.md`](13-PRO-OPEN-CORE-ARCHITECTURE.md)。

| 阶段 | 内容 | 状态 |
|------|------|------|
| **M3-a 文档与规范** | Open Core 架构文档、COMMERCIAL、FDS-11 Pro-only、MODULE-KICKOFF/开发规范同步 | [x] 2026-05-21 |
| **M3-b 扩展点 stub** | Community 仓：`LicensePort`、`ProModuleLoader` 接口 + no-op；`GET /api/meta/edition` | 规划态 |
| **M3-c 首个 Pro 包** | 私有仓 `@gsh/pro-scheduler`（整模块）；Pro Docker 镜像 POC | 规划态 |
| **M3-d 授权与升级 UX** | License 激活页、离线宽限、Pro migration 流水线 | 规划态 |
| **M4 Pro 模块扩展** | `@gsh/pro-console`（命令补全）、`@gsh/pro-audit`、多节点、云备份等按 §5 对照表逐个落地 | 规划态 |

## 4. 当前迭代待办（按优先级）

## 4.1 P0

- [x] 补齐 M0 回归基线：实例安装/启停/更新/删除全链路稳定复测（**M0 已完成**）
- [~] 当前迭代焦点切换至 **M1**（见 §3.2）
- 对齐文档与实现状态，避免“规划态误标已实现”
- 明确 API 版本演进策略（v1 -> v2 触发条件）

## 4.2 P1

- [x] Open Core 架构文档与 Pro 功能对照表已发布（M3-a）
- 设计模块 12 的最小可用实现切片（Community 站内通知 + 审计）
- 规范化错误码映射与排障指引

## 4.3 P2

- 完善 Mock 覆盖（metrics、SSE、steamcmd、network）
- 增强引导与帮助中心
- 游戏内维护公告推送（见 §3.2.1，依赖 FDS-09 命令通道）
- DST 控制台命令提示与补全（Pro-only，见 §3.2.2；`@gsh/pro-console`）

## 5. Community / Pro 功能对照表

> Canonical 边界；商业说明见 [`COMMERCIAL.md`](COMMERCIAL.md)；开发约束见 [`13-PRO-OPEN-CORE-ARCHITECTURE.md`](13-PRO-OPEN-CORE-ARCHITECTURE.md) §7。

### 5.1 分层类型

| 类型 | Community 仓 | Pro 私有包 |
|------|--------------|------------|
| **community-only** | 完整 MIT 实现 | 无 |
| **pro-only** | 升级引导 + stub | 完整实现 |
| **hybrid** | 基础能力 MIT | 增强能力专有 |

### 5.2 模块级对照

| 模块 | 类型 | Community（MIT） | Pro（`@gsh/pro-*`） | entitlement |
|------|------|------------------|---------------------|-------------|
| 00 安装运行时 | hybrid | 安装脚本、Compose、Hub 自更新 | 运行时安全加固 | `runtime_hardening` |
| 02 节点实例 | hybrid | 单节点、实例生命周期 | 远程节点、多节点调度 | `multinode` |
| 03 Cluster | hybrid | 单房间配置闭环 | 多 Cluster、配置模板库 | `cluster_advanced` |
| 04 Shard | hybrid | 分片配置与双容器编排 | 高级 worldgen 编辑 | `worldgen_advanced` |
| 05 Mod | hybrid | 列表、基础依赖提示 | 自动更新、批量策略 | `mod_advanced` |
| 06 备份 | hybrid | 手动备份与恢复 | 自动备份、云存储 | `cloud_backup` |
| 07 配置中心 | hybrid | INI/LUA 编辑与校验 | diff、导入导出 | `config_advanced` |
| 08 文件 | hybrid | 沙箱浏览、文本编辑 | 大文件、断点续传 | `file_advanced` |
| 09 实例控制台 | hybrid | 连接信息、日志 SSE、快捷指令、自定义命令输入 | DST 命令库、输入补全、自定义命令模板 | `console_commands` |
| 10 玩家访问 | hybrid | 名单维护 | 规则策略增强 | `access_advanced` |
| **11 计划任务** | **pro-only** | **升级引导页** | **任务 CRUD、调度引擎、执行历史** | `scheduler` |
| 12 通知审计 | hybrid | 站内通知、关键操作审计 | 外部通知通道 | `external_notify` |
| 横切 | pro-only | — | 许可证、Entitlement 中间件、Pro 路由注册 | — |

### 5.3 维护说明

- 各 FDS 涉及 Pro 时须含 **「Open Core 落点」** 小节。
- 边界变更须同步本节、`COMMERCIAL.md` 与 `13-PRO-OPEN-CORE-ARCHITECTURE.md`。

## 6. 风险清单

- 文档同步风险：模块状态与实际代码偏差
- 运行时风险：Docker 环境差异导致行为不一致（M0 已在 Windows `dev:compose` + 宿主机 `dev:server` 双环境回归）
- 规划拥挤风险：规划态模块过多，影响实现聚焦
- Pro 边界风险：Pro 业务代码误入 MIT 公开仓（须 Code Review 与 FDS Open Core 落点核对）

## 7. 验收映射

模块级标准见各 FDS §9；系统级流程见 `docs/11-ACCEPTANCE-TEST-STANDARD.md`。已验收项记录如下（**验收日期与回归细节以此表为准**，其他文档仅引用）：

| 对象 | 日期 | 结论 | 标准 | 回归 / 记录 |
|------|------|------|------|-------------|
| M0 可运行闭环 | 2026-05-19 | 已完成 | `11-ACCEPTANCE` §2.1 模块 00/02/09/14 | `M0-M1-REGRESSION.md` §M0 |
| 模块 03 Cluster | 2026-05-20 | 已验收 | `FDS/03-dst-cluster.md` §9 | 产品验收；`cluster-service.test.ts` 等 |
| 模块 04 Shard | 2026-05-21 | 已验收 | `FDS/04-dst-shard.md` §9 | `M0-M1-REGRESSION.md` §M1 Shard（S1–S7） |

Pro 能力（多 Cluster、配置模板库、高级 worldgen 等）未纳入上表 Community 验收范围。

## 8. 维护规则

- 功能状态变化必须同步更新：`TODO.md` + 对应 FDS + 受影响主文档
- 规划态能力未落地前不得对外标注“已上线”
- 涉及 Pro 的模块须遵循 [`13-PRO-OPEN-CORE-ARCHITECTURE.md`](13-PRO-OPEN-CORE-ARCHITECTURE.md) §7 开发约束
