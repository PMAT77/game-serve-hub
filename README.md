# GameServerHub

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/PMAT77/game-server-hub?style=social)](https://github.com/PMAT77/game-server-hub)

开源 **Steam 游戏专用服务器面板**：装得上、开得起来、管得住。  
v1 聚焦 **饥荒联机版（Don't Starve Together）** 一键开服；提供 **Community**（MIT 开源）完整自托管能力与可选 **Pro** 商业高级功能。

> 非 Klei / Valve 官方产品。饥荒相关内容仅用于兼容专用服务器配置。  
> 仓库：<https://github.com/PMAT77/game-server-hub>

---

## 特性

- **一键部署**：Linux 安装脚本 + Docker Compose（生产路径，持续对齐 [全容器化目标](docs/adr/001-full-containerization.md)）
- **实例生命周期**：创建实例、SteamCMD 安装/更新、启停、资源占用与安装日志
- **监控台**：主机 CPU / 内存 / 磁盘、Docker 概况、网卡实时流量
- **游戏控制台**：实例日志流（SSE）、游戏内命令下发
- **规划中（见 [路线图](docs/TODO.md)）**：DST 房间（Cluster）/ 世界（Shard）、Mod、备份、配置与文件管理

## Community 与 Pro

| | Community（开源） | Pro（商业，规划中） |
|---|------------------|---------------------|
| 定位 | 单机 DST 开服全流程免费 | 省心、规模、托管化能力 |
| 示例 | 房间/世界、Mod、手动备份（各 3 份） | 定时备份上云、多节点、告警等 |

完整对照见 [docs/TODO.md §8](docs/TODO.md#8-community--pro-功能对照表)。

---

## 环境要求

### 生产安装（Linux）

| 项 | 要求 |
|----|------|
| 系统 | Ubuntu 22.04+ / Debian 12+（`apt`） |
| 架构 | x86_64 / aarch64 |
| 磁盘 | 根分区可用空间 ≥ 4 GB（仅面板；游戏与存档另计） |
| 网络 | 可访问 Docker 与镜像仓库（如 `ghcr.io`） |
| 权限 | root 或 sudo |

### 本地开发

| 项 | 要求 |
|----|------|
| Node.js | `^20.19` / `^22.13` / `>=24` |
| 包管理 | pnpm `10.33+`（见 `packageManager` 字段） |
| 数据库 | SQLite（`pnpm run dev:prepare` 自动初始化） |

---

## 快速开始

### 方式一：Linux 一键安装（推荐生产）

从 GitHub 拉取安装脚本（默认分支 `main`）：

```bash
curl -fsSL https://raw.githubusercontent.com/PMAT77/game-server-hub/main/scripts/install.linux.sh | sudo bash
```

也可指定 [Release](https://github.com/PMAT77/game-server-hub/releases) 中附带的安装脚本或镜像 tag（生产环境建议固定版本号而非 `latest`）。

或克隆后本地执行：

```bash
git clone https://github.com/PMAT77/game-server-hub.git
cd game-server-hub
sudo bash ./scripts/install.linux.sh
```

脚本默认行为（可通过环境变量覆盖，见 `scripts/install.linux.sh`）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `PANEL_PORT` | `80` | 面板访问端口 |
| `PANEL_INSTALL_DIR` | `/opt/game-server-hub` | Compose 与 `panel.env` |
| `PANEL_DATA_DIR` | `/var/lib/game-server-hub` | 持久化数据 |
| `PANEL_IMAGE` | `ghcr.io/fantastic-admin/game-server-hub:latest` | 面板镜像 |

安装结束后终端会输出 **面板 URL**、**管理员账号与初始密码**（首次登录须改密）。

常用运维命令：

```bash
docker compose -f /opt/game-server-hub/docker-compose.yml ps
docker logs -f game-server-hub-panel
```

更多排障见 [docs/RUNBOOK.md](docs/RUNBOOK.md)。

### 方式二：本地开发

```bash
pnpm install
pnpm run dev:prepare   # 初始化 SQLite、日志目录
pnpm run dev           # 并行启动前端 + 后端（watch）
```

- 前端：Vite 开发服务器（端口见终端输出）  
- 后端：Fastify，配置见 `server/.env.development`  
- 健康检查：`GET http://127.0.0.1:<SERVER_PORT>/health`

> **说明**：当前开发态为宿主机 Node + 游戏进程直启；生产目标为全容器化 Compose，与开发栈对齐工作见里程碑 **M0**（[docs/TODO.md](docs/TODO.md)）。

---

## 使用流程（DST）

1. 登录面板，完成首次改密（若安装时启用 `FORCE_PASSWORD_CHANGE`）。
2. 打开 **监控台**，确认主机资源正常。
3. **节点 → 实例管理** → 创建饥荒实例，等待 SteamCMD 安装完成。
4. 启动实例，进入 **实例控制台** 查看日志。
5. （规划）在 **房间 / 世界** 页配置 Cluster、洞穴与地图预设；在客户端连接 `服务器IP:游戏端口`。

默认游戏端口 **10999**（可在实例中修改）。端口与防火墙说明见 [docs/DST-OPS.md](docs/DST-OPS.md)。

---

## 仓库结构

```text
game-server-hub/
├── src/                 # Vue 3 前端
├── server/              # Fastify 后端、Drizzle、SQLite
├── shared/              # 前后端共享契约与错误码
├── scripts/             # 安装脚本、工具
├── docs/                # 产品与技术文档（入口 docs/README.md）
├── packages/            # Fantastic-admin 工作区组件
└── docker-compose.yml   # （M0）生产编排，落地中
```

工程分层与命名见 [docs/PROJECT_BASELINE.md](docs/PROJECT_BASELINE.md)。

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/README.md](docs/README.md) | **文档总索引** |
| [docs/TODO.md](docs/TODO.md) | 路线图与开发任务 |
| [docs/PRD.md](docs/PRD.md) | 产品需求 |
| [docs/FDS/](docs/FDS/README.md) | 功能设计说明 |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | 发布验收剧本 |
| [CONTRIBUTING](docs/CONTRIBUTING.md) | 贡献指南 |

---

## 路线图摘要

| 里程碑 | 目标 |
|--------|------|
| **M0** | 全容器化运行时（Compose、游戏容器） |
| **M1** | DST 开服闭环（房间、世界、配置、控制台增强） |
| **M2** | Mod、备份、文件、新手引导 |
| **M3** | Pro 开关、授权定稿、对外发布 |
| **M4** | 第二款游戏、云厂商合作 / 多节点 |

详情与进度：[docs/TODO.md](docs/TODO.md)。

---

## 已知限制（v1 当前）

- 仅支持 **饥荒联机版** 专用服务器（Steam AppID `343050`）。
- 生产安装以 **Linux** 为主；Windows 安装包未提供。
- 多节点、托管 SaaS、RBAC 多用户均在后续版本。
- 安装脚本与运行时正在向 **面板 + 游戏全容器化** 迁移；部分能力在开发态与生产态行为可能不一致，以 [docs/TODO.md](docs/TODO.md) §4 实现状态为准。

---

## 参与贡献

欢迎 [Issue](https://github.com/PMAT77/game-server-hub/issues) 与 [Pull Request](https://github.com/PMAT77/game-server-hub/pulls)。请先阅读 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)：新功能需对应 FDS，API 变更需更新 [docs/API.md](docs/API.md)。

---

## 许可证

本仓库 **Community 版** 源代码采用 **[MIT License](LICENSE)** 发布。

| 选择 MIT 的原因（摘要） |
|------------------------|
| 利于个人与云厂商集成、二次开发与社区贡献 |
| 与「开源 Community + 商业 Pro」模式常见做法一致：核心开源，Pro 能力可单独授权 |
| 条款简短清晰，降低使用者合规成本 |

**Pro 版**：商业功能、授权与技术方案见 [docs/COMMERCIAL.md](docs/COMMERCIAL.md)，**不包含在 MIT 默认可用范围内**（除非另行书面授权）。  
功能边界见 [docs/TODO.md §8](docs/TODO.md#8-community--pro-功能对照表)。

```text
Copyright (c) 2026 PMAT77
SPDX-License-Identifier: MIT
```

---

**GameServerHub** — 让开服像点一下那么简单。
