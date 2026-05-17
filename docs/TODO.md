# GameServerHub MVP 待办清单（按优先级）

> 来源：`DEVELOPMENT.md`  
> 目标：将需求文档拆分为可执行任务，优先保证 MVP 在 90 天内落地。  
> 最后同步：**2026-05-17**（对照 `apps/game-server-hub` 前后端与安装脚本实现核对）

## 实现状态总览


| 领域                 | 状态      | 说明                                                                      |
| ------------------ | ------- | ----------------------------------------------------------------------- |
| 工程基础 / 本地开发        | ✅ 已完成   | Monorepo 边界、`pnpm dev`、环境校验、统一错误码与响应结构                                  |
| Linux 一键安装         | ✅ 基本完成  | `scripts/install.linux.sh`；缺对外 README 拉取命令与 Release 入口                  |
| 认证与会话              | ✅ 已完成   | 登录/登出/记住密码、改密与频控；首次登录强制改密（`FORCE_PASSWORD_CHANGE`）已接入                   |
| 系统设置与监控台           | ✅ 已完成   | 设置页、系统信息、网络实时流量（`console/monitor`）                                      |
| 节点与资源探测            | ✅ 已完成   | 本地节点自动注册、CPU/内存/磁盘快照                                                    |
| 实例模型与生命周期          | ✅ 已完成   | 表结构、状态机、创建/启停/重启/删除 API 与页面                                             |
| SteamCMD 与游戏安装     | 🔶 部分完成 | 仅饥荒 DST（AppID `343050`）；进程直启非 Docker；安装日志仅内存                            |
| 游戏市场 / 多游戏         | ❌ 未开始   | 无独立市场页；可安装列表仅 1 款                                                       |
| 游戏实例控制台            | ✅ 已完成   | `/app/instance/console/`* 日志 SSE + 命令下发；页面 `/node/instance/console/:id` |
| 配置 / 备份 / 文件 / Mod | ❌ 未开始   | 模块占位；`backup`/`instance_mods` 表已建，无业务 API                               |
| 发布验收               | ❌ 未开始   | 主流程演练与 Bug 门槛未执行                                                        |


**已注册后端模块**（`server/src/app.ts`）：`auth`、`system`、`node`、`instance`、`console`。  
**仅占位未注册**：`mod`、`config`、`backup`、`file`。

---

## 文档关系说明（上位文档与追溯规则）

- 本文档的上位文档为 `DEVELOPMENT.md`，仅做执行拆解与推进管理，不单独定义产品范围。
- `TODO.md` 中新增/调整条目时，必须能追溯到 `DEVELOPMENT.md` 的需求、里程碑或验收标准。
- 若出现「需求变更、范围扩展、验收口径变化」，应先更新 `DEVELOPMENT.md`，再回写 `TODO.md`。
- 若仅为实施顺序、负责人、进度状态变化，可直接维护 `TODO.md`。

## 使用说明

- 优先级定义：
  - `P0`：必须先做，阻塞核心流程（安装 → 登录 → 创建实例 → 启停 → 配置 → 备份）。
  - `P1`：MVP 关键增强，决定「可用到好用」。
  - `P2`：可后置项，不阻塞 v1.0 发布。
- 状态标记：`[x]` 已完成 · `[~]` 部分完成 · `[ ]` 未开始。
- 建议执行顺序：先完成所有 `P0`，再并行推进 `P1`，最后收尾 `P2`。

---

## P0（必须完成，MVP 核心闭环）

### 0. 项目基础与工程规范

- 明确 Monorepo 内 app 目录边界、命名规范、模块分层（见 `docs/PROJECT_BASELINE.md`）。
- 完成本地开发环境一键启动（`pnpm run dev` + `pnpm run dev:prepare`）。
- 建立环境变量分层（development/test/production）和配置加载校验（`server/src/shared/config/index.ts`）。
- 建立统一错误码、日志格式、接口返回结构（`shared/constants/error-code.ts` + `server/src/shared/http/response.ts`）。

### 1. 安装与初始化（对应第 1-2 周）

- 第一步：拉取安装脚本（GitHub Raw / Release 安装入口）。
  - 提供 Linux 一键安装脚本（Ubuntu/Debian 优先），自动安装 Docker / Node.js / SteamCMD（`scripts/install.linux.sh`）。
  - 在 README / 文档提供可直接复制的 `curl`/`wget` 命令与版本化入口（tag/release）。
- 第二步：脚本完成环境安装与主机预检（`scripts/install.linux.sh`）。
  - 自动开放必要端口并输出风险提示（防火墙、端口占用）。
  - 主机预检（系统版本、CPU 架构、磁盘剩余空间、网络连通性）。
- 第三步：拉取镜像并通过 Docker 安装/启动**面板**（`scripts/install.linux.sh`）。
  - 生成管理员账号密码、访问地址；`panel.env` 写入 `FORCE_PASSWORD_CHANGE=1`（见安装脚本）。
  - 安装状态可视化与失败回滚/重试（`install.status` + `rollback_install` + `run_with_retry`）。
- **首次登录强制改密闭环**：读取 `FORCE_PASSWORD_CHANGE`，登录后跳转改密页；改密前拦截其他 `/app/`* API。

### 2. 认证与系统设置（对应第 2 周）

- 单用户认证：登录、登出、会话保持（`server/src/modules/auth/index.ts` + 前端 token）。
- 管理员密码修改与安全校验（强密码规则、修改频率限制）。
- 系统设置页：面板端口、主题、自动更新开关（`src/views/system/settings.vue`）。
- 系统信息：CPU/内存/磁盘、OS、面板版本、Docker 状态（`/app/system/info` + `console/monitor`）。
- [~] 网络配置编排：后端已有 `/app/system/network/`*（配置/校验/应用），**前端无对应页面**。

### 3. 节点与实例基础能力（对应第 3 周）

- 本地节点注册与资源探测（`server/src/modules/node/index.ts`：`onReady` 自动注册 + `/app/node/list`）。
- 游戏实例数据模型（`game_instances` 表 + 状态：`pending_install` / `installing` / `stopped` / `running` / `error`；端口、路径、`runtime_pid`、`last_command`/`last_error`）。
- 实例生命周期 API 与页面：创建 / 启动 / 停止 / 重启 / 删除（`server/src/modules/instance/index.ts` + `src/views/node/instance/index.vue`）；危险操作二次确认。
- 节点级资源占用展示（实例管理页节点卡片：CPU/内存/磁盘使用率）。
- 实例列表维度的 **CPU/内存占用、运行时长**（需求文档要求，当前列表未采集展示）。
- 远程节点与「节点重启/关机」能力（当前仅 `local-node`，生命周期 API 亦限制本地节点）。

### 4. 游戏安装主链路（对应第 5-6 周）

- 游戏市场页：独立列表、封面、简介、安装入口（当前仅在实例创建弹窗内选择游戏）。
- [~] SteamCMD 执行器：
  - 系统级：路径配置、探测、Linux 自动安装（`/app/system/steamcmd/`*）。
  - 实例级：创建后后台 `app_update`、流式日志写入内存 Map、进度写入 `lastCommand`（`installInstanceFilesInBackground`）。
  - 安装任务中断恢复、失败重试策略（产品级，非脚本级 `run_with_retry`）。
  - 游戏服务端**手动更新**专用 API/入口。
- [~] 一键安装编排（相对 `DEVELOPMENT.md` 仍有缺口）：
  - 拉取服务端（SteamCMD）+ 饥荒 DST 默认启动脚本/配置片段生成。
  - 生成完整默认游戏配置（仅 DST 有部分脚本逻辑）。
  - 创建 **Docker 容器**并配置网络（当前为 `child_process.spawn` 直启进程，`containerId` 未使用）。
  - 安装完成后的健康检查。
- 可安装游戏列表 API（`/app/instance/games`，**当前仅 1 款**：饥荒联机 `343050`）。

### 5. 控制台与运行运维（对应第 4 周）

> **注意**：`src/views/console/monitor` 为**主机监控台**（系统信息与网卡流量），不是游戏实例控制台。

- 游戏实例实时控制台日志（SSE `/app/instance/console/stream` + 轮询补齐）。
- 向游戏服务端发送命令（`POST /app/instance/console/command`，stdin 管道）。
- 控制台基础交互：自动滚动、清空、复制（`node/instance/console.vue`）。

### 6. 配置管理（对应第 6-9 周）

- 配置文件解析层（至少 `.cfg` / `.json` / `.toml`；`registerConfigModule` 未实现）。
- 可视化配置表单（分类、默认值、中文说明）。
- 保存前格式校验与错误提示。
- 保存后重启确认与一键生效。

### 7. 备份与恢复（对应第 9 周）

- 手动备份实例世界数据 + 配置文件（`backups` 表已建，`registerBackupModule` 未实现）。
- 备份列表（时间、大小、备注）与重命名/备注编辑。
- 从备份恢复（恢复前二次确认）。
- 免费版保留策略：最多 3 份，超限自动清理最早备份。

### 8. 文件管理基础能力（对应第 4/9 周）

- [~] 目录浏览能力（仅用于安装根目录选择：`/app/system/filesystem/directories|search`，**非**实例沙箱文件管理）。
- 实例目录沙箱访问控制（禁止越界系统目录）。
- 文件上传/下载/删除/重命名/新建文件夹。
- 文本文件在线编辑。

### 9. 验收与发布门槛（贯穿第 10-12 周）

- 完成「10 分钟安装 + 15 分钟一键开服」主流程验收演练。
- 严重 Bug 清零、阻塞 Bug 清零、一般 Bug 控制在 10 个以内。
- 输出 v1.0.0 发布清单（已知限制、安装说明、回滚方案）。

---

## P1（MVP 关键增强，提升体验和竞争力）

### 10. Mod 核心能力（对应第 7-8 周）

- 创意工坊搜索与 Mod 详情展示（`instance_mods` 表已建，模块未实现）。
- Mod 一键安装/卸载、批量安装。
- 已安装 Mod 管理：启用/禁用、版本、更新时间。
- Mod 加载顺序拖拽排序。
- 基础依赖处理与冲突提示。

### 11. 三款目标游戏适配

- [~] 饥荒联机版（最高优先级）：SteamCMD 安装 + 启动脚本 + 实例管理页已打通；**配置可视化与 Mod 流程未做**。
- 泰拉瑞亚：安装、启动、基础配置。
- Valheim：安装、启动、基础配置。

### 12. 新手引导与帮助

- 首次登录 5 步引导（可跳过/可再次查看）。
- 各功能页帮助入口与说明文档。
- FAQ 与社区跳转（QQ/Discord）。

### 13. 可观测性与安全增强

- 操作审计日志（登录、安装、启停、删除、恢复等）。
- 统一鉴权中间件（当前各模块路由内 `verifyAuthorized` 重复校验）+ API 访问频控（除改密频控外）。
- 输入过滤与命令注入防护基线（实例路径已有基础校验，需覆盖命令下发等场景）。

---

## P2（可后置，不阻塞首发）

### 14. 平台与分发

- Windows Server 安装包（`.exe`）制作和签名。
- 官网/文档站建设与部署自动化。

### 15. 高级配置能力

- 原始配置编辑器（更完整语法高亮）。
- 配置导入/导出。

### 16. 文件与 Mod 进阶

- 本地 Mod `.zip` 上传（大文件、断点续传、校验）。
- 文件编辑器增强（差异对比、历史版本）。

### 17. 性能与兼容性优化

- 面板性能压测与优化（CPU < 5%，内存 < 200MB）。
- 多发行版兼容性回归（Ubuntu/Debian/Windows Server）。

---

## 里程碑对齐（建议）

- [~] **M1（第 1-4 周）**：登录 + 节点/实例基础管理 + 系统监控台 + **游戏实例控制台**已具备；**实例级资源指标**仍缺。
- **M2（第 5-8 周）**：完整安装编排（含 Docker/健康检查）+ 配置 + Mod + 三款游戏。
- **M3（第 9-12 周）**：备份 + 验收发布 + 引导/审计等 P1 项。

---

## 技术债与体验优化（不阻塞主链路，建议并行消化）

### 实例管理页（`src/views/node/instance/`）

- `index.vue` 已为薄入口；主要逻辑在 `components/InstanceManagement.vue`（约 940 行）等子组件，可继续拆分筛选栏、弹窗等。
- **节点卡片加载态改为骨架屏**（当前纯文案「节点数据加载中…」，建议 `NSkeleton` 对齐网格布局）。

### 安装体验与数据模型

- 安装字段语义拆分：`installPhase`、`installPercent`、持久化 `installLog`；`lastCommand` 仅表示最近操作/进度摘要。
- 安装日志落库或写文件（Hub 重启后 `/app/instance/install-log` 仅能 fallback 到 `lastCommand`/`lastError` 摘要）。

### 系统信息与性能

- 优化 `/app/system/info` 采集性能（并行指标、短缓存、轻量/完整接口拆分；与监控页 10s 轮询对齐，避免重复请求叠加）。

### 错误处理模板

- 统一「安装失败 / 进程启动失败 / 端口冲突」三类错误的用户提示与排障指引（前后端文案与日志关联）。

---

## 当前建议的立即开工项（本周）

按依赖与 MVP 缺口排序：

1. [x] **首次登录强制改密**：读取 `FORCE_PASSWORD_CHANGE`，登录后拦截并引导改密。
2. [x] **游戏实例控制台**：实现 `console` 模块（日志流 + 命令下发），与监控台路由/命名区分清晰。
3. [ ] **安装链路补齐**：安装日志持久化、手动更新 API；评估是否引入 Docker 或明确 v1 进程模式并更新 `DEVELOPMENT.md` 验收口径。
4. [ ] **实例列表可观测性**：单实例 CPU/内存、运行时长采集与展示。
5. [ ] **对外安装入口文档**：README 中补充 `curl`/`wget` 与 Release 版本化脚本地址。

