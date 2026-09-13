# Game Server Hub 文档

公开文档入口。产品概览与功能清单见仓库根目录 [README.md](../README.md)。

## 阅读路径

| 你是谁 | 建议顺序 |
| --- | --- |
| 第一次接触本项目 | [根 README](../README.md) → [安装指南](INSTALL.md) → [DST 开服教程](DST_TUTORIAL.md) |
| 已部署，要日常运维 | [安装指南](INSTALL.md)（升级 / 回滚 / 卸载 / 排错）→ [内存档位](MEMORY.md) → [术语表](GLOSSARY.md) |
| 想参与开发 | [开发指南](DEVELOPMENT.md) → [架构与产品边界](ARCHITECTURE.md) → [贡献流程](../CONTRIBUTING.md) |
| 维护者 / 发布负责人 | [发布流程](RELEASE.md) → [镜像发布与副本校验](IMAGE_DISTRIBUTION.md) |

## 全部文档

| 文档 | 说明 |
| --- | --- |
| [INSTALL.md](INSTALL.md) | Linux 生产安装（Docker / Native 双模式）、升级、回滚、卸载、运维与故障排查 |
| [DST_TUTORIAL.md](DST_TUTORIAL.md) | 服主视角从零开服：端口放行、面板操作、房间世界、控制台、备份与计划任务 |
| [MEMORY.md](MEMORY.md) | 宿主机内存档位（4 / 6 / 8 GiB）、洞穴与 Mod 建议、`panel.env` 预设 |
| [GLOSSARY.md](GLOSSARY.md) | 术语表：实例、分片、集群、统一镜像、离线镜像包等 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Docker / Native 双运行时、Open-Core 与插件边界 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 本地开发环境、代码地图、测试与构建镜像 |
| [API.md](API.md) | 接口约定、错误码表与新增接口的步骤 |
| [DATABASE.md](DATABASE.md) | SQLite 表结构、Drizzle 迁移流程与快照 |
| [RELEASE.md](RELEASE.md) | 版本策略、发布检查清单与 tag 流程 |
| [IMAGE_DISTRIBUTION.md](IMAGE_DISTRIBUTION.md) | 统一镜像的发布产物、digest 与离线镜像包分发 |

## 社区与治理

| 文档 | 说明 |
| --- | --- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程、PR 与提交规范 |
| [SECURITY.md](../SECURITY.md) | 漏洞报告方式与安全实践 |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | 社区行为准则 |
| [MIGRATION.md](../MIGRATION.md) | 从 fantastic-admin 母仓独立的历史记录 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更记录 |

## 内部文档说明

模块级 FDS、TODO、验收与架构设计等研发文档位于本地 **`docs_local/`** 目录（已加入 `.gitignore`，克隆仓库后默认不存在）。核心贡献者请自行维护该目录副本。
