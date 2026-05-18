# GameServerHub 文档索引

仓库概览与快速开始见根目录 **[README.md](../README.md)**（[github.com/PMAT77/game-server-hub](https://github.com/PMAT77/game-server-hub)）。开源协议：**[MIT](../LICENSE)**。  
本目录为产品与研发的**详细文档入口**。开发前请先确认所处里程碑（见 [TODO.md](TODO.md) §6），再打开对应 FDS。

## 文档分层

```text
PRD（为什么做） → TODO（做什么、何时做、Community/Pro） → FDS（怎么做、怎么验收）
                      ↓
              DOMAIN（名词与数据） + ARCHITECTURE / ADR（技术决策）
                      ↓
              API（接口契约） + ACCEPTANCE（发布验收）
                      ↓
              RUNBOOK / DST-OPS（运维） + PROJECT_BASELINE（工程规范）
```

## 核心文档

| 文档 | 用途 | 读者 |
|------|------|------|
| [PRD.md](PRD.md) | 愿景、用户、v1 范围与成功指标（精简） | 产品、研发 |
| [TODO.md](TODO.md) | 路线图、里程碑、任务勾选、§8 Community/Pro | 研发、项目管理 |
| [DOMAIN.md](DOMAIN.md) | 领域词典、实例/房间/世界关系、路径与表结构 | 全员 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 部署拓扑、模块分层、运行时与安全 | 后端、运维 |
| [API.md](API.md) | REST 接口清单与约定（含规划接口） | 前后端 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | v1 发布验收剧本 | QA、发布负责人 |

## 工程与运维

| 文档 | 用途 |
|------|------|
| [PROJECT_BASELINE.md](PROJECT_BASELINE.md) | Monorepo 边界、分层、本地启动 |
| [ROUTES.md](ROUTES.md) | 路由、菜单、权限码 |
| [RUNBOOK.md](RUNBOOK.md) | 安装、日志、常见故障 |
| [DST-OPS.md](DST-OPS.md) | 饥荒服务端运维参考 |
| [MODULE-KICKOFF.md](MODULE-KICKOFF.md) | **新模块开工**：必读文档、注意事项、AI 派工模板 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献流程与文档维护规则 |

## 架构决策（ADR）

| ADR | 标题 |
|-----|------|
| [adr/001-full-containerization.md](adr/001-full-containerization.md) | v1 全容器化 |
| [adr/002-one-instance-one-cluster.md](adr/002-one-instance-one-cluster.md) | v1 一实例一 Cluster |
| [adr/003-pro-license-tbd.md](adr/003-pro-license-tbd.md) | Pro 授权待定 |

## 功能设计说明（FDS）

| 编号 | 文档 | 模块 |
|------|------|------|
| — | [FDS/README.md](FDS/README.md) | 模板与索引 |
| 00 | [FDS/00-install-runtime.md](FDS/00-install-runtime.md) | 安装与容器运行时（M0） |
| 01 | [FDS/01-monitor.md](FDS/01-monitor.md) | 面板监控台 |
| 02 | [FDS/02-node-instance.md](FDS/02-node-instance.md) | 节点与实例 |
| 03 | [FDS/03-dst-cluster.md](FDS/03-dst-cluster.md) | DST 房间（Cluster） |
| 04 | [FDS/04-dst-shard.md](FDS/04-dst-shard.md) | DST 世界（Shard） |
| 05 | [FDS/05-mod.md](FDS/05-mod.md) | Steam Workshop Mod |
| 06 | [FDS/06-backup.md](FDS/06-backup.md) | 备份管理 |
| 07 | [FDS/07-config.md](FDS/07-config.md) | 配置中心 |
| 08 | [FDS/08-file.md](FDS/08-file.md) | 文件管理 |
| 09 | [FDS/09-console.md](FDS/09-console.md) | 实例控制台 |
| 10 | [FDS/10-player-access.md](FDS/10-player-access.md) | 玩家与访问 |
| 13 | [FDS/13-onboarding.md](FDS/13-onboarding.md) | 新手引导 |
| 14 | [FDS/14-game-adapter.md](FDS/14-game-adapter.md) | 游戏适配器 |

## 维护规则

1. **Agent 规则**：新模块开工与完工文档同步见 `.cursor/rules/module-kickoff-doc-sync.mdc`（完工同步须你明确确认）。
2. **开源双轨**：全量文档仅在本**私有**仓维护；对外开源仓瘦身与不推送范围见 [TODO.md §13](TODO.md#13-开源发布与仓库策略)。
3. **需求变更**：先改 PRD / FDS / ADR（若涉及架构），再改 TODO 任务与状态。
4. **Community/Pro 边界**：只改 [TODO.md](TODO.md) §8 及对应 FDS 标注。
5. **新模块开工**：先读 [MODULE-KICKOFF.md](MODULE-KICKOFF.md)，必须有 FDS（或显式标注「沿用 xx FDS §n」）。
6. **模块确认完成**：按 MODULE-KICKOFF §7 同步文档（须你明确确认，见 `module-kickoff-doc-sync` 规则）。
7. **接口变更**：确认后同步 [API.md](API.md) 与 `shared/contracts`（若已建类型）。
8. **里程碑结束**：跑 [ACCEPTANCE.md](ACCEPTANCE.md)，更新 [TODO.md](TODO.md) §4。

---

*最后更新：2026-05-18*
