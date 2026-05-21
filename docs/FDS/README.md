# FDS 模块索引

## 1. 说明

- 本目录存放 `Game Server Hub` 全模块功能设计说明（FDS）。
- 覆盖模块 ID 00-14，与 `docs/TODO.md` 保持一一对应。
- 模块状态统一使用：**已实现 / 部分实现 / 规划态**。
- **新模块开工前**：请先阅读 [`docs/MODULE-KICKOFF.md`](../MODULE-KICKOFF.md)（按模块 ID 查阅必读文档与上游 FDS 依赖）。

## 2. 文档清单

| 模块ID | 文件 | 模块名称 | 当前状态 |
|---|---|---|---|
| 00 | [00-install-runtime.md](00-install-runtime.md) | 平台安装与运行时 | 已实现（M0 已完成） |
| 01 | [01-monitor.md](01-monitor.md) | 监控台 | 部分实现（M1） |
| 02 | [02-node-instance.md](02-node-instance.md) | 节点与实例 | 已实现（单节点，M0 已完成） |
| 03 | [03-dst-cluster.md](03-dst-cluster.md) | DST 房间（Cluster） | 已实现（M1 Community，2026-05-20 验收） |
| 04 | [04-dst-shard.md](04-dst-shard.md) | DST 世界（Shard） | 已实现（M1 Community，2026-05-21 验收） |
| 05 | [05-mod.md](05-mod.md) | Mod 管理 | 规划态 |
| 06 | [06-backup.md](06-backup.md) | 备份恢复 | 规划态 |
| 07 | [07-config.md](07-config.md) | 配置中心 | 规划态 |
| 08 | [08-file.md](08-file.md) | 文件管理 | 规划态 |
| 09 | [09-console.md](09-console.md) | 实例控制台 | 已实现（M0 已完成） |
| 10 | [10-player-access.md](10-player-access.md) | 玩家与访问 | 规划态 |
| 11 | [11-scheduler.md](11-scheduler.md) | 计划任务 | 规划态 |
| 12 | [12-notice-audit.md](12-notice-audit.md) | 通知与审计 | 规划态 |
| 13 | [13-onboarding.md](13-onboarding.md) | 新手引导 | 部分实现 |
| 14 | [14-game-adapter.md](14-game-adapter.md) | 游戏适配器 | 已实现（DST v1，M0 已完成） |

## 3. 统一章节结构

每份 FDS 至少包含以下内容：

1. 背景与目标
2. 角色与前置条件
3. 功能范围与边界
4. 功能清单与主流程
5. 接口与输入输出
6. 业务规则
7. 异常与边界处理
8. 非功能要求
9. 验收标准
10. 版本状态与后续里程碑

## 4. 维护规则

- 模块实现变化需同步更新对应 FDS。
- TODO 状态与 FDS 状态必须一致。
- 规划态模块必须显式标注“未实现能力”与“实现前置条件”。
